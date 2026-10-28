let allProducts = [];
let filteredProducts = [];
let cart = [];
let currentCategory = 'ALL';
let currentCoords = null;
let currentAddress = '';
let selectedOrder = null;
let allOrders = [];

let currentRole = localStorage.getItem('asorti_user_role') || 'AGENT';
let currentAgentName = localStorage.getItem('asorti_agent_name') || 'Javohir';
const MASTER_PIN_HASH = '93352a86094a964ef548e72c79a9f6187b7f561773c31f3371e86ecffe9a4dd9';

let createMap = null;
let createMarker = null;
let modalMap = null;
let modalMarker = null;

let deliveryMapInstance = null;
let deliveryMarkersLayer = null;
let deliveryRoutePolyline = null;
let selectedDeliveryDate = '';
let currentRouteStops = [];

const SUPABASE_URL = 'https://yzwwoahgynzvcnsvqmrr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_H2t-F2IAZnKPeMEMFiYH-g_USbzXscM';
let supabaseClient = null;

document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  initUserRoles();
  initDateInputs();
  initNavigation();
  initMapWidgets();
  initGeolocation();
  initOfflineSync();
  initDeliveryMap();
  loadProducts();
  loadOrders();
  setupEventListeners();
});

function initSupabase() {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      supabaseClient
        .channel('public:orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            const newOrder = mapFromDb(payload.new);
            if (!allOrders.some(o => o.id === newOrder.id || o.orderNumber === newOrder.orderNumber)) {
              allOrders.unshift(newOrder);
              saveLocalOrders(allOrders);
              renderControlOrders();
              renderHistoryOrders();
              showToast('Новый заказ №' + newOrder.orderNumber + ' получен из базы!');
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = mapFromDb(payload.new);
            const idx = allOrders.findIndex(o => o.id === updated.id);
            if (idx !== -1) {
              allOrders[idx] = updated;
              saveLocalOrders(allOrders);
              renderControlOrders();
              renderHistoryOrders();
            }
          } else if (payload.eventType === 'DELETE') {
            allOrders = allOrders.filter(o => o.id !== payload.old.id);
            saveLocalOrders(allOrders);
            renderControlOrders();
            renderHistoryOrders();
          }
        })
        .subscribe();
    }
  } catch (err) {
    console.warn('Supabase init error:', err);
  }
}

function mapToDb(payload, customId) {
  const coordsData = {
    ...(payload.coords || {}),
    ownerName: payload.ownerName || '',
    ownerPhone: payload.ownerPhone || '',
    dismissedFromControl: payload.dismissedFromControl === true
  };

  return {
    id: customId || crypto.randomUUID(),
    order_number: payload.orderNumber,
    delivery_date: payload.deliveryDate,
    store_name: payload.storeName,
    address: payload.address,
    coords: coordsData,
    agent_name: payload.agentName || 'Javohir',
    agent_phone: payload.agentPhone || '',
    status: payload.status || 'planned',
    created_at: payload.createdAt || new Date().toISOString(),
    items: payload.items,
    total_amount: payload.totalAmount
  };
}

function mapFromDb(row) {
  const coordsObj = row.coords || {};
  return {
    id: row.id,
    orderNumber: row.order_number || row.orderNumber || '000000',
    deliveryDate: row.delivery_date || row.deliveryDate || '',
    storeName: row.store_name || row.storeName || 'Магазин',
    ownerName: row.owner_name || row.ownerName || coordsObj.ownerName || '',
    ownerPhone: row.owner_phone || row.ownerPhone || coordsObj.ownerPhone || '',
    address: row.address,
    coords: {
      lat: coordsObj.lat || null,
      lng: coordsObj.lng || null
    },
    dismissedFromControl: coordsObj.dismissedFromControl === true || coordsObj.dismissedFromControl === 'true',
    agentName: row.agent_name || row.agentName || 'Javohir',
    agentPhone: row.agent_phone || row.agentPhone || '',
    status: row.status || 'planned',
    createdAt: row.created_at || row.createdAt,
    items: row.items || [],
    totalAmount: row.total_amount !== undefined ? row.total_amount : (row.totalAmount || 0)
  };
}

function isTestOrder(order) {
  if (!order) return true;
  const store = String(order.storeName || order.store_name || '').trim();
  const num = String(order.orderNumber || order.order_number || '').trim();
  const amt = Number(order.totalAmount !== undefined ? order.totalAmount : (order.total_amount || 0));
  if (store === '12345' || store === '54321' || store === '15667') return true;
  if ((num === '000000' || !num) && amt === 0) return true;
  if (store.includes('12345') || store.includes('54321') || store.includes('15667')) return true;
  return false;
}

function purgeTestOrders() {
  try {
    const rawLocal = localStorage.getItem('cached_all_orders');
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(o => !isTestOrder(o));
        localStorage.setItem('cached_all_orders', JSON.stringify(cleaned));
      }
    }
  } catch (e) {}

  try {
    const rawQueue = localStorage.getItem('offline_order_queue');
    if (rawQueue) {
      const parsedQ = JSON.parse(rawQueue);
      if (Array.isArray(parsedQ)) {
        const cleanedQ = parsedQ.filter(item => !isTestOrder(item.payload));
        localStorage.setItem('offline_order_queue', JSON.stringify(cleanedQ));
      }
    }
  } catch (e) {}

  try {
    localStorage.removeItem('orders_deleted_audit_log');
  } catch (e) {}
}

function getOfflineQueue() {
  try {
    const q = JSON.parse(localStorage.getItem('offline_order_queue') || '[]');
    return Array.isArray(q) ? q.filter(item => !isTestOrder(item.payload)) : [];
  } catch (e) {
    return [];
  }
}

function saveOfflineQueue(q) {
  localStorage.setItem('offline_order_queue', JSON.stringify(q));
}

function getLocalOrders() {
  try {
    const list = JSON.parse(localStorage.getItem('cached_all_orders') || '[]');
    return Array.isArray(list) ? list.filter(o => !isTestOrder(o)) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalOrders(orders) {
  const safe = Array.isArray(orders) ? orders.filter(o => !isTestOrder(o)) : [];
  localStorage.setItem('cached_all_orders', JSON.stringify(safe));
}

function initOfflineSync() {
  window.addEventListener('online', () => {
    showToast('Связь восстановлена! Синхронизация...');
    syncOfflineOrders();
  });

  if (navigator.onLine) {
    syncOfflineOrders();
  }
}

async function syncOfflineOrders() {
  const queue = getOfflineQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      if (supabaseClient) {
        const dbRow = mapToDb(item.payload, item.payload.id);
        const { error } = await supabaseClient.from('orders').insert([dbRow]);
        if (error) throw error;
        showToast('Офлайн заказ №' + (item.tempOrderNumber || '') + ' синхронизирован с базой!');
      } else {
        const res = await fetch(SUPABASE_URL + '/rest/v1/orders', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(mapToDb(item.payload, item.payload.id))
        });
        if (res.ok) {
          showToast('Офлайн заказ №' + (item.tempOrderNumber || '') + ' синхронизирован с базой!');
        } else {
          remaining.push(item);
        }
      }
    } catch (e) {
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);
  loadOrders();
}

function initDateInputs() {
  const deliveryInput = document.getElementById('deliveryDateInput');
  const dateBadge = document.getElementById('dateDisplayBadge');
  const batchInput = document.getElementById('batchDateInput');
  const batchBadge = document.getElementById('batchDateDisplayBadge');

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = yyyy + '-' + mm + '-' + dd;

  function updateBadge(inputEl, badgeEl) {
    if (!inputEl.value) {
      badgeEl.innerText = '--.--.----';
      return;
    }
    const parts = inputEl.value.split('-');
    if (parts.length === 3) {
      badgeEl.innerText = parts[2] + '.' + parts[1] + '.' + parts[0];
    }
  }

  if (deliveryInput) {
    deliveryInput.value = todayStr;
    updateBadge(deliveryInput, dateBadge);
    deliveryInput.addEventListener('input', () => updateBadge(deliveryInput, dateBadge));
  }

  if (batchInput) {
    batchInput.value = todayStr;
    updateBadge(batchInput, batchBadge);
    batchInput.addEventListener('input', () => updateBadge(batchInput, batchBadge));
  }
}

function initMapWidgets() {
  const defaultLat = 41.3111;
  const defaultLng = 69.2797;

  try {
    createMap = L.map('createOrderMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([defaultLat, defaultLng], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(createMap);

    createMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(createMap);

    createMarker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      currentCoords = { lat: pos.lat, lng: pos.lng };
      await reverseGeocode(pos.lat, pos.lng);
    });

    createMap.on('click', async (e) => {
      const pos = e.latlng;
      createMarker.setLatLng(pos);
      currentCoords = { lat: pos.lat, lng: pos.lng };
      await reverseGeocode(pos.lat, pos.lng);
    });
  } catch (err) {
    console.warn('Map initialization error:', err);
  }
}

function setCreateMapLocation(lat, lng) {
  if (!createMap || !createMarker) return;
  const pos = [lat, lng];
  createMap.setView(pos, 15);
  createMarker.setLatLng(pos);
  setTimeout(() => {
    createMap.invalidateSize();
  }, 200);
}

function showModalOrderMap(lat, lng, storeName, address) {
  const container = document.getElementById('modalMapBox');
  if (!container) return;
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const useLat = Number(lat);
  const useLng = Number(lng);

  setTimeout(() => {
    try {
      if (!modalMap) {
        modalMap = L.map('modalOrderMap', {
          zoomControl: true,
          attributionControl: false
        }).setView([useLat, useLng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(modalMap);

        modalMarker = L.marker([useLat, useLng]).addTo(modalMap);
      } else {
        modalMap.setView([useLat, useLng], 15);
        modalMarker.setLatLng([useLat, useLng]);
      }
      const title = storeName || 'Магазин';
      const addr = address || '';
      modalMarker.bindPopup('<b>' + title + '</b>' + (addr ? '<br>' + addr : '')).openPopup();
      modalMap.invalidateSize();
      setTimeout(() => {
        if (modalMap) modalMap.invalidateSize();
      }, 300);
    } catch (e) {
      console.warn('Modal map error:', e);
    }
  }, 120);
}

async function reverseGeocode(lat, lon) {
  let addressFound = '';

  if (window.ymaps && window.ymaps.geocode) {
    try {
      const res = await ymaps.geocode([lat, lon], { json: true, results: 1 });
      const geoObj = res.GeoObjectCollection.featureMember[0]?.GeoObject;
      if (geoObj) {
        addressFound = geoObj.metaDataProperty?.GeocoderMetaData?.text || geoObj.name || '';
      }
    } catch (e) { }
  }

  if (!addressFound) {
    try {
      const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&accept-language=ru';
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (data && data.address) {
        const a = data.address;
        const parts = [];
        if (a.road) parts.push(a.road + (a.house_number ? ' ' + a.house_number : ''));
        if (a.suburb || a.city_district || a.quarter) parts.push(a.suburb || a.city_district || a.quarter);
        if (a.city || a.town || a.county) parts.push(a.city || a.town || a.county);
        if (parts.length > 0) addressFound = parts.join(', ');
      }
      if (!addressFound && data && data.display_name) {
        addressFound = data.display_name;
      }
    } catch (e) { }
  }

  if (!addressFound) {
    try {
      const res = await fetch('/api/geocode?lat=' + lat + '&lon=' + lon);
      const data = await res.json();
      addressFound = data.address || '';
    } catch (e) { }
  }

  currentAddress = addressFound || ('Координаты: ' + Number(lat).toFixed(6) + ', ' + Number(lon).toFixed(6));
  applyLocationUi(lat, lon, currentAddress, false);
}

window.openInNavigator = function(lat, lng, label) {
  if (!lat || !lng) {
    showToast('Координаты точки не указаны');
    return;
  }
  const useLat = Number(lat);
  const useLng = Number(lng);
  if (isNaN(useLat) || isNaN(useLng)) {
    showToast('Некорректные координаты');
    return;
  }
  if (window.OrdersNative && typeof window.OrdersNative.openYandexNavigator === 'function') {
    window.OrdersNative.openYandexNavigator(useLat, useLng, label || 'Магазин');
    return;
  }
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    const naviUrl = 'yandexnavi://build_route_on_map?lat_to=' + useLat + '&lon_to=' + useLng;
    const webFallback = 'https://yandex.ru/maps/?rtext=~' + useLat + ',' + useLng + '&rtt=auto';
    const start = Date.now();
    window.location.href = naviUrl;
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        window.open(webFallback, '_blank');
      }
    }, 800);
  } else {
    window.open('https://yandex.ru/maps/?rtext=~' + useLat + ',' + useLng + '&rtt=auto', '_blank');
  }
};

function applyLocationUi(lat, lon, addressStr, moveMap = true) {
  const btn = document.getElementById('btnGetLocation');
  const btnText = document.getElementById('btnLocationText');
  const manualInput = document.getElementById('manualAddressInput');
  const yandexBar = document.getElementById('yandexLinksRow');
  const yandexNavBtn = document.getElementById('yandexNavBtn');

  btn.classList.add('active');
  btnText.innerText = 'Локация определена';
  manualInput.value = addressStr;
  const detectedBadge = document.getElementById('detectedAddressText');
  if (detectedBadge) {
    detectedBadge.innerText = addressStr;
  }
  currentAddress = addressStr;
  currentCoords = { lat, lng: lon };

  yandexBar.style.display = 'flex';
  yandexNavBtn.onclick = (e) => {
    e.preventDefault();
    window.openInNavigator(lat, lon, addressStr);
  };
  yandexNavBtn.href = 'https://yandex.ru/maps/?rtext=~' + lat + ',' + lon + '&rtt=auto';

  if (moveMap) {
    setCreateMapLocation(lat, lon);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2200);
}

function formatPrice(val) {
  return Number(val || 0).toLocaleString('ru-RU').replace(/\s/g, '.');
}

function numberToWordsRu(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Ноль сум';

  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const onesFem = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function getTriad(n, isFem) {
    let res = [];
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const o = n % 10;
    if (h > 0) res.push(hundreds[h]);
    if (t === 1) {
      res.push(teens[o]);
    } else {
      if (t > 1) res.push(tens[t]);
      if (o > 0) res.push(isFem ? onesFem[o] : ones[o]);
    }
    return res.join(' ');
  }

  function pluralForm(n, form1, form2, form5) {
    n = Math.abs(n) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return form5;
    if (n1 > 1 && n1 < 5) return form2;
    if (n1 === 1) return form1;
    return form5;
  }

  const millions = Math.floor(num / 1000000);
  const thousands = Math.floor((num % 1000000) / 1000);
  const remainder = num % 1000;

  let parts = [];
  if (millions > 0) {
    parts.push(getTriad(millions, false) + ' ' + pluralForm(millions, 'миллион', 'миллиона', 'миллионов'));
  }
  if (thousands > 0) {
    parts.push(getTriad(thousands, true) + ' ' + pluralForm(thousands, 'тысяча', 'тысячи', 'тысяч'));
  }
  if (remainder > 0) {
    parts.push(getTriad(remainder, false));
  }

  let str = parts.join(' ').trim();
  if (!str) return 'Ноль сум';
  return (str.charAt(0).toUpperCase() + str.slice(1)) + ' сум';
}

function sanitizeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function initNavigation() {
  const allTabs = document.querySelectorAll('.desktop-tab-btn, .nav-item[data-tab]');
  allTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      if (targetId) switchTab(targetId);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.desktop-tab-btn, .nav-item').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const activeView = document.getElementById(tabId);
  if (activeView) activeView.classList.add('active');

  if (tabId === 'tab-create' && createMap) {
    setTimeout(() => createMap.invalidateSize(), 200);
  }

  if (tabId === 'tab-map') {
    renderDeliveryRouteMap();
  }

  if (tabId === 'tab-control' || tabId === 'tab-history') {
    loadOrders();
  }
}

function initGeolocation() {
  const btn = document.getElementById('btnGetLocation');
  const btnText = document.getElementById('btnLocationText');
  const manualInput = document.getElementById('manualAddressInput');
  const searchInput = document.getElementById('addressSearchQueryInput');
  const btnSearch = document.getElementById('btnSearchAddressOnMap');

  if (btn) {
    btn.addEventListener('click', () => {
      btnText.innerText = 'Определение GPS...';
      btn.classList.remove('active');

      if (!navigator.geolocation) {
        showToast('GPS не поддерживается. Укажите точку на карте или найдите по адресу');
        btnText.innerText = 'Укажите точку на карте';
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          currentCoords = { lat, lng: lon };
          await reverseGeocode(lat, lon);
          setCreateMapLocation(lat, lon);
          showToast('Локация определена по GPS');
        },
        (err) => {
          console.warn('Geolocation error:', err);
          showToast('GPS сигнал недоступен. Укажите точку на карте или найдите по адресу');
          btnText.innerText = 'Укажите точку на карте';
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  async function searchAddressStep1() {
    const q = (searchInput ? searchInput.value : '').trim();
    if (!q) {
      showToast('Введите адрес или ориентир для поиска');
      if (searchInput) searchInput.focus();
      return;
    }
    showToast('Поиск на карте: ' + q + '...');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent('Ташкент ' + q) + '&viewbox=69.05,41.45,69.45,41.15&bounded=0&limit=1&accept-language=ru';
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (data && data.length > 0) {
        const item = data[0];
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        currentCoords = { lat, lng: lon };
        currentAddress = q + ' (' + item.display_name.split(',').slice(0, 3).join(',') + ')';
        applyLocationUi(lat, lon, currentAddress, true);
        showToast('Точка найдена и установлена на карте');
      } else {
        showToast('Адрес не найден, укажите точку кликом на карте');
      }
    } catch (e) {
      showToast('Ошибка поиска адреса');
    }
  }

  if (btnSearch) {
    btnSearch.addEventListener('click', searchAddressStep1);
  }
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchAddressStep1();
      }
    });
  }

  if (manualInput) {
    manualInput.addEventListener('input', () => {
      currentAddress = manualInput.value.trim();
    });
  }
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;
  const d = [];
  for (let i = 0; i <= s1.length; i++) d[i] = [i];
  for (let j = 0; j <= s2.length; j++) d[0][j] = j;
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[s1.length][s2.length];
}

function cleanFuzzyString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s.,]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchProductTokens(product, tokens) {
  if (!tokens || !tokens.length) return true;

  const rawFull = cleanFuzzyString(product.fullName || '');
  const rawBrand = cleanFuzzyString(product.brand || '');
  const rawType = cleanFuzzyString(product.type || '');
  const rawVolume = cleanFuzzyString(product.volume || '');
  const rawNote = cleanFuzzyString(product.note || '');
  const rawCategory = cleanFuzzyString(product.category || '');
  const colorsText = cleanFuzzyString((product.colors || []).join(' '));

  const combinedSearchText = (rawFull + ' ' + rawBrand + ' ' + rawType + ' ' + rawVolume + ' ' + rawNote + ' ' + rawCategory + ' ' + colorsText);
  const words = combinedSearchText.split(/\s+/).filter(Boolean);

  const productNumbers = (rawFull + ' ' + rawVolume).match(/\d+([.,]\d+)?/g) || [];
  const cleanNumbers = productNumbers.map(n => n.replace(',', '.'));

  return tokens.every(token => {
    const cleanTok = token.replace(/ё/g, 'е');

    if (combinedSearchText.includes(cleanTok)) {
      return true;
    }

    const tokenNum = cleanTok.replace(',', '.').replace(/[^0-9.]/g, '');
    if (tokenNum) {
      if (cleanNumbers.includes(tokenNum) || rawVolume.includes(tokenNum) || rawFull.includes(tokenNum)) {
        return true;
      }
    }

    if (cleanTok.length >= 2) {
      if (words.some(w => w.startsWith(cleanTok))) {
        return true;
      }
    }

    if (cleanTok.length >= 3) {
      const maxDist = cleanTok.length <= 4 ? 1 : 2;
      const foundFuzzy = words.some(w => {
        if (Math.abs(w.length - cleanTok.length) > maxDist) return false;
        return levenshteinDistance(w, cleanTok) <= maxDist;
      });
      if (foundFuzzy) return true;
    }

    return false;
  });
}

async function loadProducts() {
  if (window.EMBEDDED_PRODUCTS && Array.isArray(window.EMBEDDED_PRODUCTS) && window.EMBEDDED_PRODUCTS.length > 0) {
    allProducts = window.EMBEDDED_PRODUCTS;
    updateProductCountBadge();
    filterAndRenderProducts();
  }

  try {
    const res = await fetch('/api/products?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        allProducts = data;
        updateProductCountBadge();
        filterAndRenderProducts();
      }
    }
  } catch (err) {
    if (!allProducts.length && window.EMBEDDED_PRODUCTS) {
      allProducts = window.EMBEDDED_PRODUCTS;
      updateProductCountBadge();
      filterAndRenderProducts();
    }
  }
}

function updateProductCountBadge() {
  const badge = document.getElementById('productsTotalCountBadge');
  if (badge && allProducts.length) {
    badge.innerText = allProducts.length;
  }
}

function filterAndRenderProducts() {
  const searchInput = document.getElementById('productSearchInput');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

  filteredProducts = allProducts.filter(p => {
    const matchCat = (currentCategory === 'ALL') || (p.category === currentCategory);
    const matchSearch = matchProductTokens(p, tokens);
    return matchCat && matchSearch;
  });

  renderProductList();
}

function renderProductList() {
  const container = document.getElementById('productPickerContainer');
  if (!filteredProducts.length) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">Товары не найдены</div>';
    return;
  }

  container.innerHTML = filteredProducts.map(p => {
    const inCart = cart.find(c => c.product.id === p.id);
    const count = inCart ? inCart.quantity : 0;
    const colorsTag = (p.colors && p.colors.length) ?
      '<div class="item-colors-badge"> Цвета: ' + p.colors.join(', ') + '</div>' : '';

    const catLabel = p.category === 'КАПСУЛЫ ДЛЯ СТИРКИ' ? 'Капсулы' : p.category.split(' ')[0];

    return '<div class="product-row-item">' +
      '<div class="item-left">' +
      '<span class="item-category-tag">' + catLabel + '</span>' +
      '<div class="item-title">' + p.fullName + '</div>' +
      '<div class="item-meta">' + (p.volume || '') + ' ' + (p.note ? '• ' + p.note : '') + colorsTag + '</div>' +
      '<div class="item-price">' + formatPrice(p.price) + ' сум</div>' +
      '</div>' +
      '<div class="item-stepper">' +
      (count === 0 ?
        '<button type="button" class="btn-step add-first" onclick="addToCartDirect(' + p.id + ')">&plus; Выбрать</button>' :
        '<button type="button" class="btn-step" onclick="updateItemCount(' + p.id + ', -1)">&minus;</button>' +
        '<input type="number" min="1" class="step-input" value="' + count + '" onchange="setItemCountDirect(' + p.id + ', this.value)">' +
        '<button type="button" class="btn-step" onclick="updateItemCount(' + p.id + ', 1)">&plus;</button>'
      ) +
      '</div>' +
      '</div>';
  }).join('');
}

function getColorClass(col) {
  if (!col) return 'default';
  const c = col.toLowerCase();
  if (c.includes('бирюз') || c.includes('голуб') || c.includes('cyan')) return 'cyan';
  if (c.includes('зел') || c.includes('лотос') || c.includes('lotus') || c.includes('green')) return 'green';
  if (c.includes('син') || c.includes('лилия') || c.includes('lilyum') || c.includes('blue')) return 'blue';
  if (c.includes('жел') || c.includes('жёл') || c.includes('hanimeli') || c.includes('жимолость') || c.includes('yellow')) return 'yellow';
  if (c.includes('золот') || c.includes('gold')) return 'gold';
  if (c.includes('оранж') || c.includes('янт') || c.includes('amber') || c.includes('orange')) return 'orange';
  if (c.includes('борд') || c.includes('maroon')) return 'maroon';
  if (c.includes('фиол') || c.includes('лав') || c.includes('сирен') || c.includes('пурпур') || c.includes('purple')) return 'purple';
  if (c.includes('роз') || c.includes('пион') || c.includes('sakura') || c.includes('сакур') || c.includes('pink')) return 'pink';
  if (c.includes('крас') || c.includes('орхид') || c.includes('orkide') || c.includes('red')) return 'red';
  if (c.includes('бел') || c.includes('кокос') || c.includes('ваниль') || c.includes('white')) return 'white';
  if (c.includes('чер') || c.includes('чёр') || c.includes('black') || c.includes('siyah')) return 'black';
  return 'default';
}

function getColorSummaryText(item) {
  if (!item.product.colors || !item.colorBreakdown) return '';
  const parts = [];
  item.product.colors.forEach(col => {
    const q = Number(item.colorBreakdown[col]) || 0;
    if (q > 0) parts.push(col + ': ' + q + ' шт');
  });
  return parts.length ? parts.join(', ') : 'Не выбрано';
}

function syncColorBreakdownToTotal(item) {
  if (!item.product.colors || !item.product.colors.length) return;
  if (!item.colorBreakdown) item.colorBreakdown = {};
  let currentSum = 0;
  item.product.colors.forEach(c => {
    if (typeof item.colorBreakdown[c] !== 'number') item.colorBreakdown[c] = 0;
    currentSum += item.colorBreakdown[c];
  });
  const diff = item.quantity - currentSum;
  if (diff !== 0) {
    const firstCol = item.product.colors.find(c => (item.colorBreakdown[c] || 0) > 0) || item.product.colors[0];
    item.colorBreakdown[firstCol] = Math.max(0, (item.colorBreakdown[firstCol] || 0) + diff);
    let newSum = Object.values(item.colorBreakdown).reduce((a, b) => a + b, 0);
    if (newSum !== item.quantity) {
      item.colorBreakdown[item.product.colors[0]] = item.quantity;
      item.product.colors.slice(1).forEach(c => item.colorBreakdown[c] = 0);
    }
  }
}

window.addToCartDirect = function (productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const initialColors = {};
  if (p.colors && p.colors.length) {
    p.colors.forEach((c, idx) => {
      initialColors[c] = (idx === 0 ? 1 : 0);
    });
  }
  cart.push({
    product: p,
    quantity: 1,
    colorBreakdown: initialColors
  });
  updateCartUi();
  renderProductList();
  showToast('+1 ' + p.brand);
};

window.setItemCountDirect = function (productId, val) {
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed <= 0) {
    removeFromCart(productId);
    return;
  }
  const item = cart.find(c => c.product.id === productId);
  if (item) {
    item.quantity = parsed;
    if (item.product.colors && item.product.colors.length) {
      syncColorBreakdownToTotal(item);
    }
    updateCartUi();
    renderProductList();
  }
};

window.updateItemCount = function (productId, delta) {
  const item = cart.find(c => c.product.id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter(c => c.product.id !== productId);
  } else if (item.product.colors && item.product.colors.length) {
    syncColorBreakdownToTotal(item);
  }
  updateCartUi();
  renderProductList();
};

window.updateItemColorCount = function (productId, color, delta) {
  const item = cart.find(c => c.product.id === productId);
  if (!item || !item.product.colors) return;
  if (!item.colorBreakdown) item.colorBreakdown = {};
  const current = Number(item.colorBreakdown[color]) || 0;
  const next = Math.max(0, current + delta);
  item.colorBreakdown[color] = next;
  const sum = item.product.colors.reduce((s, col) => s + (Number(item.colorBreakdown[col]) || 0), 0);
  if (sum <= 0) {
    item.colorBreakdown[color] = 1;
    item.quantity = 1;
  } else {
    item.quantity = sum;
  }
  updateCartUi();
  renderProductList();
};

window.setItemColorCountDirect = function (productId, color, val) {
  const item = cart.find(c => c.product.id === productId);
  if (!item || !item.product.colors) return;
  const parsed = parseInt(val, 10);
  const next = isNaN(parsed) || parsed < 0 ? 0 : parsed;
  if (!item.colorBreakdown) item.colorBreakdown = {};
  item.colorBreakdown[color] = next;
  const sum = item.product.colors.reduce((s, col) => s + (Number(item.colorBreakdown[col]) || 0), 0);
  if (sum <= 0) {
    item.colorBreakdown[color] = 1;
    item.quantity = 1;
  } else {
    item.quantity = sum;
  }
  updateCartUi();
  renderProductList();
};

window.removeFromCart = function (productId) {
  cart = cart.filter(c => c.product.id !== productId);
  updateCartUi();
  renderProductList();
};

function updateCartUi() {
  const cartCard = document.getElementById('cartCard');
  const countBadge = document.getElementById('cartItemCountBadge');
  const totalSumEl = document.getElementById('cartTotalSum');
  const wordsEl = document.getElementById('cartTotalInWords');
  const trayContainer = document.getElementById('cartTrayItems');

  if (cart.length === 0) {
    cartCard.style.display = 'none';
    return;
  }

  cartCard.style.display = 'block';
  countBadge.innerText = '' + cart.length;

  const total = cart.reduce((sum, i) => sum + (i.quantity * i.product.price), 0);
  totalSumEl.innerText = formatPrice(total) + ' сум';
  wordsEl.innerText = 'Сумма прописью: ' + numberToWordsRu(total);

  if (trayContainer) {
    trayContainer.innerHTML = cart.map(i => {
      const hasColors = i.product.colors && i.product.colors.length;
      let colorsBox = '';
      if (hasColors) {
        const chipsHtml = i.product.colors.map(col => {
          const colQty = (i.colorBreakdown && i.colorBreakdown[col] !== undefined) ? i.colorBreakdown[col] : 0;
          const colClass = getColorClass(col);
          return '<div class="color-picker-item">' +
            '<span class="color-dot color-dot-' + colClass + '"></span>' +
            '<span class="color-name">' + col + '</span>' +
            '<div class="color-item-stepper">' +
            '<button type="button" class="btn-col-step" onclick="updateItemColorCount(' + i.product.id + ', \'' + col + '\', -1)">&minus;</button>' +
            '<input type="number" min="0" class="col-qty-input" value="' + colQty + '" onchange="setItemColorCountDirect(' + i.product.id + ', \'' + col + '\', this.value)">' +
            '<button type="button" class="btn-col-step" onclick="updateItemColorCount(' + i.product.id + ', \'' + col + '\', 1)">&plus;</button>' +
            '</div>' +
            '</div>';
        }).join('');

        colorsBox = '<div class="cart-tray-colors-box">' +
          '<div class="colors-box-header">' +
          '<span class="colors-box-label">Цвета:</span>' +
          '<span class="colors-box-sum">' + getColorSummaryText(i) + '</span>' +
          '</div>' +
          '<div class="colors-chips-row">' + chipsHtml + '</div>' +
          '</div>';
      }

      return '<div class="cart-tray-row-container">' +
        '<div class="cart-tray-row">' +
        '<div class="cart-tray-name">' +
        '<div>' + i.product.fullName + '</div>' +
        '<div class="cart-tray-sub">' + formatPrice(i.product.price) + ' сум/шт' + (hasColors ? ' • выбор цветов ниже' : '') + '</div>' +
        '</div>' +
        '<div class="cart-tray-ctrls">' +
        '<input type="number" min="1" class="cart-tray-qty-input" value="' + i.quantity + '" onchange="setItemCountDirect(' + i.product.id + ', this.value)">' +
        '<div class="cart-tray-price">' + formatPrice(i.quantity * i.product.price) + ' сум</div>' +
        '<button type="button" class="btn-remove-tray" title="Убрать из заказа" onclick="removeFromCart(' + i.product.id + ')">&times;</button>' +
        '</div>' +
        '</div>' +
        colorsBox +
        '</div>';
    }).join('');
  }
}

async function submitOrder() {
  const storeName = document.getElementById('storeNameInput').value.trim();
  const ownerName = (document.getElementById('ownerNameInput')?.value || '').trim();
  const ownerPhone = (document.getElementById('ownerPhoneInput')?.value || '').trim();
  const deliveryDate = document.getElementById('deliveryDateInput').value;
  const manualAddress = document.getElementById('manualAddressInput').value.trim();

  if (!storeName) {
    alert('Пожалуйста, введите название магазина получателя');
    document.getElementById('storeNameInput').focus();
    return;
  }
  if (!deliveryDate) {
    alert('Пожалуйста, выберите дату доставки');
    return;
  }
  if (cart.length === 0) {
    alert('Пожалуйста, выберите хотя бы 1 товар в заказ');
    return;
  }

  const chosenAddress = manualAddress || currentAddress || 'г. Ташкент';
  const orderNumber = String(Math.floor(100000 + Math.random() * 900000));
  const orderUuid = crypto.randomUUID();

  const orderItems = cart.map(i => {
    let colorText = '';
    if (i.product.colors && i.colorBreakdown) {
      const parts = [];
      for (const col of i.product.colors) {
        const q = Number(i.colorBreakdown[col]) || 0;
        if (q > 0) parts.push(col + ': ' + q + ' шт');
      }
      if (parts.length > 0) colorText = parts.join(', ');
    }

    return {
      id: i.product.id,
      fullName: i.product.fullName,
      volume: i.product.volume || '-',
      price: Number(i.product.price) || 0,
      costPrice: Number(i.product.costPrice) || 0,
      quantity: Number(i.quantity) || 1,
      colorText: colorText,
      colorBreakdown: i.colorBreakdown || null
    };
  });

  const totalAmount = orderItems.reduce((s, i) => s + (i.price * i.quantity), 0);

  const newOrder = {
    id: orderUuid,
    orderNumber: orderNumber,
    deliveryDate: deliveryDate,
    storeName: storeName,
    ownerName: ownerName,
    ownerPhone: ownerPhone,
    address: chosenAddress,
    coords: currentCoords,
    agentName: (document.getElementById('agentNameInput') ? document.getElementById('agentNameInput').value.trim() : '') || currentAgentName || 'Javohir',
    agentPhone: '',
    status: 'planned',
    createdAt: new Date().toISOString(),
    items: orderItems,
    totalAmount: totalAmount
  };

  const btn = document.getElementById('btnSubmitOrder');
  btn.disabled = true;
  btn.innerText = 'Сохранение накладной...';

  try {
    if (supabaseClient) {
      const dbRow = mapToDb(newOrder, orderUuid);
      const { error } = await supabaseClient.from('orders').insert([dbRow]);
      if (error) throw error;
    } else {
      const res = await fetch(SUPABASE_URL + '/rest/v1/orders', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(mapToDb(newOrder, orderUuid))
      });
      if (!res.ok) throw new Error('Supabase save failed');
    }

    showToast('Накладная №' + newOrder.orderNumber + ' готова и сохранена в базе!');

    allOrders.unshift(newOrder);
    saveLocalOrders(allOrders);
    renderControlOrders();
    renderHistoryOrders();

    cart = [];
    document.getElementById('storeNameInput').value = '';
    const ownerNameEl = document.getElementById('ownerNameInput');
    if (ownerNameEl) ownerNameEl.value = '';
    const ownerPhoneEl = document.getElementById('ownerPhoneInput');
    if (ownerPhoneEl) ownerPhoneEl.value = '';
    updateCartUi();
    renderProductList();
    openOrderModal(newOrder);
  } catch (err) {
    const offlineOrder = {
      ...newOrder,
      orderNumber: newOrder.orderNumber + ' (Офлайн)'
    };

    const q = getOfflineQueue();
    q.push({ tempOrderNumber: newOrder.orderNumber, payload: newOrder });
    saveOfflineQueue(q);

    allOrders.unshift(offlineOrder);
    saveLocalOrders(allOrders);
    renderControlOrders();
    renderHistoryOrders();

    showToast('Сохранено локально! При появлении сети отправится автоматически в базу.');

    cart = [];
    document.getElementById('storeNameInput').value = '';
    updateCartUi();
    renderProductList();
    openOrderModal(offlineOrder);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><span>Сформировать накладной лист</span>';
  }
}

async function loadOrders() {
  purgeTestOrders();
  try {
    let rows = null;
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false });
      if (!error && data) rows = data;
    }

    if (!rows) {
      const res = await fetch(SUPABASE_URL + '/rest/v1/orders?select=*&order=created_at.desc', {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      });
      if (res.ok) rows = await res.json();
    }

    if (rows && Array.isArray(rows)) {
      const dbOrders = rows.map(mapFromDb).filter(o => !isTestOrder(o));
      const offlineQueue = getOfflineQueue();
      const offlineOrders = offlineQueue.map(q => q.payload).filter(Boolean).filter(o => !isTestOrder(o));

      const combined = [...offlineOrders];
      dbOrders.forEach(o => {
        if (!combined.some(existing => existing.id === o.id || existing.orderNumber === o.orderNumber)) {
          combined.push(o);
        }
      });
      allOrders = combined.filter(o => !isTestOrder(o));
      saveLocalOrders(allOrders);
    } else {
      allOrders = getLocalOrders();
    }
  } catch (err) {
    allOrders = getLocalOrders();
  }

  renderControlOrders();
  renderHistoryOrders();
}

let currentHistoryFilter = 'ALL';

function renderControlOrders() {
  const container = document.getElementById('controlOrdersList');
  const countBadge = document.getElementById('controlOrdersCount');
  if (!container) return;

  const controlOrders = allOrders.filter(o => !o.dismissedFromControl && !isTestOrder(o));
  countBadge.innerText = controlOrders.length + ' накладных';

  if (!controlOrders.length) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Нет активных заказов в контроле. Создайте заказ на Шаге 1.</div>';
    return;
  }

  container.innerHTML = controlOrders.map(order => createOrderCardHtml(order, true)).join('');
}

function renderHistoryOrders(filterStatus) {
  if (filterStatus !== undefined) currentHistoryFilter = filterStatus;
  const container = document.getElementById('historyOrdersList');
  if (!container) return;

  let filtered = allOrders.filter(o => !isTestOrder(o));
  if (currentHistoryFilter !== 'ALL') {
    filtered = filtered.filter(o => o.status === currentHistoryFilter);
  }

  if (!filtered.length) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">В этой категории пока нет заказов.</div>';
    return;
  }

  container.innerHTML = filtered.map(order => createOrderCardHtml(order, false)).join('');
}

function createOrderCardHtml(order, isControlTab) {
  let badgeClass = 'badge-planned';
  let badgeText = 'В планах';
  if (order.status === 'delivered') {
    badgeClass = 'badge-delivered';
    badgeText = 'Сдан';
  } else if (order.status === 'cancelled') {
    badgeClass = 'badge-cancelled';
    badgeText = 'Отменён';
  }

  const orderNum = order.orderNumber || order.order_number || '000000';
  const rawDate = order.deliveryDate || order.delivery_date || '';
  const cisFormatted = rawDate ? rawDate.split('-').reverse().join('.') : '-';
  const store = order.storeName || order.store_name || 'Магазин';
  const totalAmt = order.totalAmount !== undefined ? order.totalAmount : (order.total_amount !== undefined ? order.total_amount : 0);

  const actionBtnHtml = isControlTab
    ? '<button type="button" class="btn-order-dismiss" onclick="dismissOrderFromControl(\'' + order.id + '\', event)">Убрать из контроля</button>'
    : '';

  return '<div class="order-card">' +
    '<div class="order-card-header">' +
    '<div class="order-num">№ ' + orderNum + '</div>' +
    '<div class="order-date-tag">' + cisFormatted + '</div>' +
    '</div>' +
    '<div class="order-store-title">' + store + '</div>' +
    '<div class="order-address-text">' + (order.address || 'г. Ташкент') + '</div>' +
    '<div class="order-card-footer">' +
    '<div>' +
    '<div class="order-amount">' + formatPrice(totalAmt) + ' сум</div>' +
    '<span class="badge-status ' + badgeClass + '">' + badgeText + '</span>' +
    '</div>' +
    '<div class="order-actions-row">' +
    '<button type="button" class="btn-order-open" onclick="openOrderModalById(\'' + order.id + '\')">Открыть</button>' +
    actionBtnHtml +
    '</div>' +
    '</div>' +
    '</div>';
}

window.openOrderModalById = function (orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (o) openOrderModal(o);
};

window.dismissOrderFromControl = async function (orderId, evt) {
  if (evt) evt.stopPropagation();
  const order = allOrders.find(x => x.id === orderId);
  if (!order) return;

  if (!confirm('Убрать заказ № ' + order.orderNumber + ' (' + order.storeName + ') из Контроля? Он останется в Истории заказов.')) return;

  try {
    order.dismissedFromControl = true;
    const updatedCoords = {
      lat: order.coords ? order.coords.lat : null,
      lng: order.coords ? order.coords.lng : null,
      ownerName: order.ownerName || '',
      ownerPhone: order.ownerPhone || '',
      dismissedFromControl: true
    };

    if (supabaseClient) {
      await supabaseClient.from('orders').update({ coords: updatedCoords }).eq('id', orderId);
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + orderId, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ coords: updatedCoords })
      });
    }

    saveLocalOrders(allOrders);
    showToast('Заказ № ' + order.orderNumber + ' убран из Контроля (сохранён в Истории)');
    renderControlOrders();
    renderHistoryOrders(currentHistoryFilter);

    const modal = document.getElementById('orderDetailModal');
    if (modal.classList.contains('active') && selectedOrder && selectedOrder.id === orderId) {
      modal.classList.remove('active');
    }
  } catch (err) {
    alert(err.message);
  }
};

window.deleteOrderFromHistory = function () {};
window.deleteOrderById = function () {};

function openOrderModal(order) {
  selectedOrder = order;
  const modal = document.getElementById('orderDetailModal');
  const cisFormatted = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('.') : '-';
  document.getElementById('modalOrderNumber').innerText = 'Накладная № ' + order.orderNumber;
  document.getElementById('modalOrderDate').innerText = 'Дата доставки: ' + cisFormatted;
  document.getElementById('modalStoreName').innerText = order.storeName;
  const ownerInfoEl = document.getElementById('modalOwnerInfo');
  if (ownerInfoEl) {
    if (order.ownerName || order.ownerPhone) {
      ownerInfoEl.style.display = 'block';
      ownerInfoEl.innerText = 'Владелец: ' + (order.ownerName || 'Не указан') + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : '');
    } else {
      ownerInfoEl.style.display = 'none';
    }
  }
  document.getElementById('modalLocationText').innerText = order.address || 'г. Ташкент';
  document.getElementById('modalTotalSum').innerText = formatPrice(order.totalAmount) + ' сум';

  const yandexNavContainer = document.getElementById('modalYandexNavContainer');
  const yandexNavLink = document.getElementById('modalYandexNavLink');
  const noCoordsNotice = document.getElementById('modalNoCoordsNotice');
  const modalMapBox = document.getElementById('modalMapBox');
  const btnSetLocationFromDetails = document.getElementById('btnOpenSetLocationFromDetails');

  if (btnSetLocationFromDetails) {
    btnSetLocationFromDetails.onclick = () => openSetOrderLocationModal(order.id);
  }

  if (order.coords && order.coords.lat && order.coords.lng && !isNaN(Number(order.coords.lat))) {
    if (noCoordsNotice) noCoordsNotice.style.display = 'none';
    if (modalMapBox) modalMapBox.style.display = 'block';
    if (yandexNavContainer) yandexNavContainer.style.display = 'block';
    if (yandexNavLink) {
      yandexNavLink.onclick = (e) => {
        e.preventDefault();
        window.openInNavigator(order.coords.lat, order.coords.lng, order.storeName);
      };
      yandexNavLink.href = 'https://yandex.ru/maps/?rtext=~' + order.coords.lat + ',' + order.coords.lng + '&rtt=auto';
    }
    showModalOrderMap(order.coords.lat, order.coords.lng, order.storeName, order.address);
  } else {
    if (noCoordsNotice) noCoordsNotice.style.display = 'block';
    if (modalMapBox) modalMapBox.style.display = 'none';
    if (yandexNavContainer) yandexNavContainer.style.display = 'none';
  }

  let orderCost = 0;
  (order.items || []).forEach(item => {
    let costPrice = Number(item.costPrice);
    if (!costPrice || isNaN(costPrice)) {
      const found = allProducts.find(p => p.id === item.id || p.fullName === item.fullName);
      costPrice = found ? Number(found.costPrice) || 0 : 0;
    }
    orderCost += ((Number(item.quantity) || 1) * costPrice);
  });
  const orderProfit = Math.max(0, (order.totalAmount || 0) - orderCost);
  const costSumEl = document.getElementById('modalOwnerCostSum');
  const profitSumEl = document.getElementById('modalOwnerProfitSum');
  if (costSumEl) costSumEl.innerText = formatPrice(orderCost) + ' сум';
  if (profitSumEl) profitSumEl.innerText = formatPrice(orderProfit) + ' сум';

  const itemsContainer = document.getElementById('modalItemsList');
  itemsContainer.innerHTML = (order.items || []).map(i =>
    '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px dashed #e2e8f0;">' +
    '<div>' +
    '<b>' + i.fullName + '</b>' +
    '<span style="color: var(--text-muted); font-size: 11px;"> (' + (i.volume || '-') + ')</span>' +
    (i.colorText ? '<div style="font-size: 11px; color: #2563eb; font-weight: 600; margin-top: 2px;">' + i.colorText + '</div>' : '') +
    '</div>' +
    '<div style="text-align: right;">' +
    '<div>' + i.quantity + ' шт &times; ' + formatPrice(i.price) + '</div>' +
    '<b style="color: var(--primary-navy);">' + formatPrice(i.quantity * i.price) + ' сум</b>' +
    '</div>' +
    '</div>'
  ).join('') + '</div>';

  const btnDismissModal = document.getElementById('btnModalDismissControl');
  if (btnDismissModal) {
    if (order.dismissedFromControl) {
      btnDismissModal.innerText = 'Заказ уже убран из Контроля';
      btnDismissModal.disabled = true;
      btnDismissModal.style.opacity = '0.5';
    } else {
      btnDismissModal.innerText = 'Убрать этот заказ из Контроля';
      btnDismissModal.disabled = false;
      btnDismissModal.style.opacity = '1';
    }
  }

  modal.classList.add('active');
}

async function updateOrderStatus(newStatus) {
  if (!selectedOrder) return;
  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('orders')
        .update({ status: newStatus })
        .eq('id', selectedOrder.id)
        .select();
      if (error) throw error;
      if (data && data[0]) selectedOrder = mapFromDb(data[0]);
    } else {
      const res = await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + selectedOrder.id, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Status update failed');
      const rows = await res.json();
      if (rows && rows[0]) selectedOrder = mapFromDb(rows[0]);
    }

    const idx = allOrders.findIndex(o => o.id === selectedOrder.id);
    if (idx !== -1) {
      allOrders[idx].status = newStatus;
      saveLocalOrders(allOrders);
    }

    showToast('Статус: ' + newStatus);
    document.getElementById('orderDetailModal').classList.remove('active');
    renderControlOrders();
    renderHistoryOrders();
  } catch (err) {
    alert(err.message);
  }
}

function buildSingleTableXml(order) {
  const orderNumber = sanitizeXml(order.orderNumber || '000001');
  const deliveryDate = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('/') : '00/00/0000';
  const clientName = sanitizeXml(order.storeName || 'Магазин');
  const ownerText = (order.ownerName || order.ownerPhone)
    ? sanitizeXml('Владелец: ' + (order.ownerName || '-') + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : ''))
    : '';
  const address = sanitizeXml(order.address || 'г. Ташкент');
  const agentName = sanitizeXml(order.agentName || 'Javohir');
  const totalAmount = order.totalAmount || 0;
  const totalFormatted = formatPrice(totalAmount);
  const totalInWords = sanitizeXml(numberToWordsRu(totalAmount));

  let rowsXml = '';
  (order.items || []).forEach(item => {
    const name = sanitizeXml(item.fullName || item.name || '') + (item.colorText ? ' (Цвета: ' + sanitizeXml(item.colorText) + ')' : '');
    const vol = sanitizeXml(item.volume || '-');
    const qty = item.quantity + ' шт';
    const price = formatPrice(item.price);
    const sum = formatPrice(item.quantity * item.price);

    rowsXml += '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + name + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + vol + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + qty + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + price + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + sum + '</w:t></w:r></w:p></w:tc>' +
      '</w:tr>';
  });

  return '<w:tbl>' +
    '<w:tblPr>' +
    '<w:tblW w:w="10200" w:type="dxa"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:left w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:right w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '</w:tblBorders>' +
    '<w:jc w:val="center"/>' +
    '</w:tblPr>' +
    '<w:tr>' +
    '<w:tc>' +
    '<w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="24"/></w:rPr><w:t>НАКЛАДНОЙ ЛИСТ № ' + orderNumber + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:tcW w:w="2600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Дата: ' + deliveryDate + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="2600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>ASORTI TRADE PLUS</w:t></w:r></w:p>' +
    '</w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc>' +
    '<w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/></w:tcPr>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ОТПРАВИТЕЛЬ:</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="20"/><w:color w:val="003366"/></w:rPr><w:t>OOO "ASORTI TRADE PLUS"</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Агент: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + agentName + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="4"/><w:tcW w:w="5200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/></w:tcPr>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ПОЛУЧАТЕЛЬ (МАГАЗИН):</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="22"/><w:color w:val="111827"/></w:rPr><w:t>' + clientName + '</w:t></w:r></w:p>' +
    (ownerText ? '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="0066CC"/></w:rPr><w:t>' + ownerText + '</w:t></w:r></w:p>' : '') +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Адрес: </w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>' + address + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>НАИМЕНОВАНИЕ ТОВАРА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ОБЪЁМ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>КОЛ-ВО</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ЦЕНА (СУМ)</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>СУММА (СУМ)</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    rowsXml +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ИТОГО К ОПЛАТЕ: </w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>' + totalInWords + '</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="003366"/><w:sz w:val="22"/></w:rPr><w:t>' + totalFormatted + ' сум</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6800" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>Отпустил (экспедитор/склад): ____________________ (Подпись)</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="3400" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>Принял покупатель: _________________ (Подпись)</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>';
}

async function generateDocxBlob(orders) {
  if (!Array.isArray(orders)) orders = [orders];
  if (!window.JSZip || !window.TEMPLATE_DOCX_B64) {
    throw new Error('JSZip or template not loaded');
  }

  const zip = await window.JSZip.loadAsync(window.TEMPLATE_DOCX_B64, { base64: true });
  let combinedTablesXml = '';

  orders.forEach((order, idx) => {
    const copy1 = { ...order, storeName: order.storeName + ' [ЭКЗЕМПЛЯР МАГАЗИНА]' };
    const copy2 = { ...order, storeName: order.storeName + ' [ЭКЗЕМПЛЯР ПОСТАВЩИКА - ASORTI]' };
    combinedTablesXml += buildSingleTableXml(copy1);
    combinedTablesXml += '<w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="dashed" w:sz="6" w:space="4" w:color="003366"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:i/><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t></w:t></w:r></w:p>';
    combinedTablesXml += buildSingleTableXml(copy2);
    if (idx < orders.length - 1) {
      combinedTablesXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
  });

  const bodyXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' +
    combinedTablesXml +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body>' +
    '</w:document>';

  zip.file('word/document.xml', bodyXml);
  return await zip.generateAsync({ type: 'blob' });
}

function buildPdfMakeDocDefinition(orders) {
  if (!Array.isArray(orders)) orders = [orders];
  const content = [];

  orders.forEach((order, idx) => {
    if (idx > 0) {
      content.push({ text: '', pageBreak: 'after' });
    }

    function createCopySection(copyTitle) {
      const cisDate = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('.') : '-';

      const itemRows = [
        [
          { text: 'НАИМЕНОВАНИЕ', style: 'tableHeader', alignment: 'left' },
          { text: 'ОБЪЁМ', style: 'tableHeader', alignment: 'center' },
          { text: 'КОЛ-ВО', style: 'tableHeader', alignment: 'center' },
          { text: 'ЦЕНА', style: 'tableHeader', alignment: 'right' },
          { text: 'СУММА', style: 'tableHeader', alignment: 'right' }
        ]
      ];

      (order.items || []).forEach(it => {
        itemRows.push([
          { text: (it.fullName || it.name) + (it.colorText ? '\n(Цвета: ' + it.colorText + ')' : ''), fontSize: 8 },
          { text: it.volume || '-', fontSize: 8, alignment: 'center' },
          { text: it.quantity + ' шт', fontSize: 8, alignment: 'center', bold: true },
          { text: formatPrice(it.price) + ' сум', fontSize: 8, alignment: 'right' },
          { text: formatPrice(it.quantity * it.price) + ' сум', fontSize: 8, alignment: 'right', bold: true }
        ]);
      });

      return [
        {
          table: {
            widths: ['*'],
            body: [[
              {
                fillColor: '#003366',
                columns: [
                  { text: 'НАКЛАДНОЙ ЛИСТ № ' + order.orderNumber + ' ' + copyTitle, color: '#FFFFFF', bold: true, fontSize: 10, margin: [4, 4, 0, 4] },
                  { text: 'Дата: ' + cisDate, color: '#FFFFFF', bold: true, fontSize: 10, alignment: 'right', margin: [0, 4, 4, 4] }
                ]
              }
            ]]
          },
          layout: 'noBorders'
        },
        {
          margin: [0, 4, 0, 4],
          columns: [
            {
              width: '50%',
              fontSize: 8.5,
              stack: [
                { text: [{ text: 'ОТПРАВИТЕЛЬ: ', bold: true }, 'OOO "ASORTI TRADE PLUS"'] },
                { text: [{ text: 'ТОРГОВЫЙ АГЕНТ: ', bold: true }, order.agentName || 'Javohir'] }
              ]
            },
            {
              width: '50%',
              fontSize: 8.5,
              stack: [
                { text: [{ text: 'ПОЛУЧАТЕЛЬ: ', bold: true }, order.storeName] },
                (order.ownerName || order.ownerPhone ? { text: [{ text: 'ВЛАДЕЛЕЦ: ', bold: true, color: '#0066CC' }, (order.ownerName || '-') + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : '')] } : ''),
                { text: [{ text: 'АДРЕС: ', bold: true }, order.address || 'г. Ташкент'] }
              ]
            }
          ]
        },
        {
          table: {
            headerRows: 1,
            widths: ['42%', '14%', '12%', '16%', '16%'],
            body: itemRows
          },
          layout: {
            fillColor: function (rowIndex) {
              return rowIndex === 0 ? '#E2E8F0' : null;
            },
            hLineColor: function () { return '#CBD5E1'; },
            vLineColor: function () { return '#CBD5E1'; }
          }
        },
        {
          margin: [0, 4, 0, 4],
          table: {
            widths: ['*'],
            body: [[
              {
                fillColor: '#F1F5F9',
                text: [
                  { text: 'ИТОГО К ОПЛАТЕ: ', bold: true, color: '#003366', fontSize: 9 },
                  { text: formatPrice(order.totalAmount) + ' сум  (' + numberToWordsRu(order.totalAmount) + ')', bold: true, color: '#003366', fontSize: 9 }
                ],
                margin: [4, 4, 4, 4]
              }
            ]]
          },
          layout: 'noBorders'
        }
      ];
    }

    content.push(...createCopySection('(ЭКЗЕМПЛЯР МАГАЗИНА)'));
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 10, x2: 545, y2: 10, dash: { length: 4, space: 4 }, lineColor: '#94A3B8' }],
      margin: [0, 6, 0, 10]
    });
    content.push(...createCopySection('(ЭКЗЕМПЛЯР ПОСТАВЩИКА - ASORTI)'));
  });

  return {
    pageSize: 'A4',
    pageMargins: [25, 25, 25, 25],
    content: content,
    styles: {
      tableHeader: {
        fontSize: 8,
        bold: true,
        color: '#003366'
      }
    }
  };
}

async function generatePdfBlob(orders) {
  if (!window.pdfMake) throw new Error('pdfMake not loaded');
  const docDef = buildPdfMakeDocDefinition(orders);
  return new Promise((resolve) => {
    window.pdfMake.createPdf(docDef).getBlob((blob) => {
      resolve(blob);
    });
  });
}

async function downloadCurrentOrder(fmt) {
  if (!selectedOrder) return;
  showToast('Генерация накладной...');

  try {
    if (fmt === 'docx') {
      const blob = await generateDocxBlob([selectedOrder]);
      if (window.saveAs) {
        window.saveAs(blob, 'Накладная_№' + selectedOrder.orderNumber + '.docx');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Накладная_№' + selectedOrder.orderNumber + '.docx';
        link.click();
      }
      showToast('DOCX накладная скачана!');
    } else if (fmt === 'pdf') {
      const blob = await generatePdfBlob([selectedOrder]);
      if (window.saveAs) {
        window.saveAs(blob, 'Накладная_№' + selectedOrder.orderNumber + '.pdf');
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Накладная_№' + selectedOrder.orderNumber + '.pdf';
        link.click();
      }
      showToast('PDF накладная скачана!');
    }
  } catch (err) {
    console.error('Download error:', err);
    alert('Ошибка скачивания: ' + err.message);
  }
}

async function downloadBatchOrders(fmt) {
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  showToast('Формирование сборника (' + matchingOrders.length + ' заказов)...');

  try {
    if (fmt === 'docx') {
      const blob = await generateDocxBlob(matchingOrders);
      const filename = 'Сборник_Заказов_' + d + '.docx';
      if (window.saveAs) {
        window.saveAs(blob, filename);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
      }
      showToast('Сборник DOCX скачан!');
    } else if (fmt === 'pdf') {
      const blob = await generatePdfBlob(matchingOrders);
      const filename = 'Сборник_Заказов_' + d + '.pdf';
      if (window.saveAs) {
        window.saveAs(blob, filename);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
      }
      showToast('Сборник PDF скачан!');
    }
  } catch (err) {
    console.error('Batch download error:', err);
    alert('Ошибка сборника: ' + err.message);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function shareOrderFileToTelegram(fmt) {
  if (!selectedOrder) return;
  const o = selectedOrder;
  const cisFormatted = o.deliveryDate ? o.deliveryDate.split('-').reverse().join('.') : '-';

  const itemsText = (o.items || []).map((it, idx) =>
    (idx + 1) + '. ' + it.fullName + (it.colorText ? ' [Цвета: ' + it.colorText + ']' : '') + ' — ' + it.quantity + ' шт x ' + formatPrice(it.price) + ' = ' + formatPrice(it.quantity * it.price) + ' сум'
  ).join('\n');

  let text = 'НАКЛАДНАЯ № ' + o.orderNumber + '\n' +
    'Магазин: ' + o.storeName + '\n' +
    (o.ownerName || o.ownerPhone ? 'Владелец: ' + (o.ownerName || '-') + (o.ownerPhone ? ' (' + o.ownerPhone + ')' : '') + '\n' : '') +
    'Дата: ' + cisFormatted + '\n' +
    'Адрес: ' + (o.address || 'г. Ташкент') + '\n';

  if (o.coords && o.coords.lat) {
    text += 'Яндекс Карты: https://yandex.ru/maps/?rtext=~' + o.coords.lat + ',' + o.coords.lng + '&rtt=auto\n';
  }

  text += '\nТовары:\n' + itemsText + '\n\n' +
    'ИТОГО К ОПЛАТЕ: ' + formatPrice(o.totalAmount) + ' сум\n' +
    'ASORTI TRADE PLUS';

  showToast('Подготовка файла ' + fmt.toUpperCase() + '...');

  try {
    let blob;
    let fileName;
    let mimeType;

    if (fmt === 'docx') {
      blob = await generateDocxBlob([o]);
      fileName = 'Накладная_№' + o.orderNumber + '.docx';
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      blob = await generatePdfBlob([o]);
      fileName = 'Накладная_№' + o.orderNumber + '.pdf';
      mimeType = 'application/pdf';
    }

    if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
      const base64Data = await blobToBase64(blob);
      window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
      showToast('Отправка файла в Telegram...');
      return;
    }

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Накладная №' + o.orderNumber,
          text: text,
          files: [file]
        });
        showToast('Файл успешно отправлен!');
        return;
      }
    }

    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    const tgUrl = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    window.open(tgUrl, '_blank');
    showToast('Файл скачан и открыт Telegram');
  } catch (err) {
    console.error('Share error:', err);
    alert('Ошибка отправки файла: ' + err.message);
  }
}

async function shareBatchFileToTelegram(fmt) {
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  const cisDate = d.split('-').reverse().join('.');
  const totalSumAll = matchingOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  let text = 'СБОРНЫЙ ЛИСТ НАКЛАДНЫХ НА ' + cisDate + '\n' +
    'Всего накладных: ' + matchingOrders.length + '\n\n';

  matchingOrders.forEach((o, idx) => {
    text += (idx + 1) + '. №' + o.orderNumber + ' — ' + o.storeName + '\n' +
      (o.ownerName || o.ownerPhone ? '   Владелец: ' + (o.ownerName || '-') + (o.ownerPhone ? ' (' + o.ownerPhone + ')' : '') + '\n' : '') +
      '   Адрес: ' + (o.address || 'г. Ташкент') + '\n' +
      '   Сумма: ' + formatPrice(o.totalAmount) + ' сум\n';
    if (o.coords && o.coords.lat) {
      text += '   Яндекс Карты: https://yandex.ru/maps/?rtext=~' + o.coords.lat + ',' + o.coords.lng + '&rtt=auto\n';
    }
  });

  text += '\nОБЩАЯ СУММА ЗА ДЕНЬ: ' + formatPrice(totalSumAll) + ' сум\n' +
    'ASORTI TRADE PLUS';

  showToast('Подготовка сборника ' + fmt.toUpperCase() + '...');

  try {
    let blob;
    let fileName;
    let mimeType;

    if (fmt === 'docx') {
      blob = await generateDocxBlob(matchingOrders);
      fileName = 'Сборник_Заказов_' + d + '.docx';
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      blob = await generatePdfBlob(matchingOrders);
      fileName = 'Сборник_Заказов_' + d + '.pdf';
      mimeType = 'application/pdf';
    }

    if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
      const base64Data = await blobToBase64(blob);
      window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
      showToast('Отправка сборника в Telegram...');
      return;
    }

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Сборник заказов на ' + cisDate,
          text: text,
          files: [file]
        });
        showToast('Сборник успешно отправлен!');
        return;
      }
    }

    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    const tgUrl = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    window.open(tgUrl, '_blank');
    showToast('Сборник скачан и открыт Telegram');
  } catch (err) {
    console.error('Batch share error:', err);
    alert('Ошибка отправки сборника: ' + err.message);
  }
}

async function requestAppUpdate() {
  if (window.OrdersNative && typeof window.OrdersNative.checkUpdates === 'function') {
    window.OrdersNative.checkUpdates();
    return;
  }

  if (!navigator.onLine) {
    alert('Для проверки обновлений необходимо подключение к интернету');
    return;
  }

  showToast('Проверка обновлений...');
  try {
    const res = await fetch('https://asorty-trade-plus.web.app/update.json?t=' + Date.now());
    if (!res.ok) throw new Error('Сервер обновлений недоступен');
    const info = await res.json();
    alert('ASORTI ORDERS\n\nТекущая версия актуальна.\nПоследний релиз: v' + info.versionName + '\n\n' + (info.changelog || ''));
  } catch (err) {
    alert('Не удалось связаться с сервером: ' + err.message);
  }
}

function setupEventListeners() {
  document.getElementById('productSearchInput').addEventListener('input', filterAndRenderProducts);

  document.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.getAttribute('data-category');
      filterAndRenderProducts();
    });
  });

  document.querySelectorAll('#tab-history .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-history .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const st = btn.getAttribute('data-status');
      renderHistoryOrders(st);
    });
  });

  document.getElementById('btnSubmitOrder').addEventListener('click', submitOrder);

  document.getElementById('btnCloseModal').addEventListener('click', () => {
    document.getElementById('orderDetailModal').classList.remove('active');
  });
  document.getElementById('btnCloseBatchModal').addEventListener('click', () => {
    document.getElementById('batchModal').classList.remove('active');
  });

  document.getElementById('btnDownloadDocxAction').addEventListener('click', () => downloadCurrentOrder('docx'));
  document.getElementById('btnDownloadPdfAction').addEventListener('click', () => downloadCurrentOrder('pdf'));
  
  const btnShareDocx = document.getElementById('btnShareDocxTelegramAction');
  if (btnShareDocx) {
    btnShareDocx.addEventListener('click', () => shareOrderFileToTelegram('docx'));
  }
  const btnSharePdf = document.getElementById('btnSharePdfTelegramAction');
  if (btnSharePdf) {
    btnSharePdf.addEventListener('click', () => shareOrderFileToTelegram('pdf'));
  }

  const btnCostDocx = document.getElementById('btnDownloadCostDocxAction');
  if (btnCostDocx) {
    btnCostDocx.addEventListener('click', downloadOrderCostDocx);
  }
  const btnCostTg = document.getElementById('btnShareCostTelegramAction');
  if (btnCostTg) {
    btnCostTg.addEventListener('click', shareOrderCostToTelegram);
  }

  const btnDismissModal = document.getElementById('btnModalDismissControl');
  if (btnDismissModal) {
    btnDismissModal.addEventListener('click', () => {
      if (selectedOrder) dismissOrderFromControl(selectedOrder.id);
    });
  }


  document.getElementById('btnMarkPlanned').addEventListener('click', () => updateOrderStatus('planned'));
  document.getElementById('btnMarkDelivered').addEventListener('click', () => updateOrderStatus('delivered'));
  document.getElementById('btnMarkCancelled').addEventListener('click', () => updateOrderStatus('cancelled'));

  document.getElementById('btnConsolidateToday').addEventListener('click', () => {
    document.getElementById('batchModal').classList.add('active');
  });

  const btnDocx = document.getElementById('btnBatchDocx');
  if (btnDocx) {
    btnDocx.addEventListener('click', () => downloadBatchOrders('docx'));
  }
  const btnPdf = document.getElementById('btnBatchPdf');
  if (btnPdf) {
    btnPdf.addEventListener('click', () => downloadBatchOrders('pdf'));
  }
  const btnBatchDocxTg = document.getElementById('btnBatchDocxTelegram');
  if (btnBatchDocxTg) {
    btnBatchDocxTg.addEventListener('click', () => shareBatchFileToTelegram('docx'));
  }
  const btnBatchPdfTg = document.getElementById('btnBatchPdfTelegram');
  if (btnBatchPdfTg) {
    btnBatchPdfTg.addEventListener('click', () => shareBatchFileToTelegram('pdf'));
  }

  const btnBatchCostDocxAsortiBtn = document.getElementById('btnBatchCostDocxAsorti');
  if (btnBatchCostDocxAsortiBtn) {
    btnBatchCostDocxAsortiBtn.addEventListener('click', downloadBatchCostAsortiDocx);
  }
  const btnBatchCostTgAsortiBtn = document.getElementById('btnBatchCostTgAsorti');
  if (btnBatchCostTgAsortiBtn) {
    btnBatchCostTgAsortiBtn.addEventListener('click', shareBatchCostAsortiToTelegram);
  }
  const btnBatchCostDocxSupplierBtn = document.getElementById('btnBatchCostDocxSupplier');
  if (btnBatchCostDocxSupplierBtn) {
    btnBatchCostDocxSupplierBtn.addEventListener('click', downloadBatchCostSupplierDocx);
  }
  const btnBatchCostTgSupplierBtn = document.getElementById('btnBatchCostTgSupplier');
  if (btnBatchCostTgSupplierBtn) {
    btnBatchCostTgSupplierBtn.addEventListener('click', shareBatchCostSupplierToTelegram);
  }

  const btnUpdateDesk = document.getElementById('btnCheckUpdatesDesktop');
  if (btnUpdateDesk) {
    btnUpdateDesk.addEventListener('click', requestAppUpdate);
  }
  const btnUpdateMob = document.getElementById('btnCheckUpdatesMobile');
  if (btnUpdateMob) {
    btnUpdateMob.addEventListener('click', requestAppUpdate);
  }

  const btnAccountSwitcher = document.getElementById('btnAccountSwitcher');
  if (btnAccountSwitcher) {
    btnAccountSwitcher.addEventListener('click', openAccountModal);
  }

  const btnCloseAccount = document.getElementById('btnCloseAccountModal');
  if (btnCloseAccount) {
    btnCloseAccount.addEventListener('click', () => {
      document.getElementById('accountModal').classList.remove('active');
    });
  }

  const btnToggleAdmin = document.getElementById('btnToggleAdminBox');
  async function verifyPin(pin) {
    if (!pin) return false;
    const clean = pin.trim();
    if (clean === '7693') return true;
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(clean);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex === MASTER_PIN_HASH;
    } catch (e) {
      return clean === '7693';
    }
  }

  const btnSubmitPin = document.getElementById('btnSubmitAdminPin');
  if (btnSubmitPin) {
    btnSubmitPin.addEventListener('click', async () => {
      const pinInput = document.getElementById('ownerPinInput');
      const pinErr = document.getElementById('ownerPinError');
      const val = (pinInput ? pinInput.value : '').trim();
      const isMatch = await verifyPin(val);
      if (isMatch) {
        currentRole = 'OWNER';
        localStorage.setItem('asorti_user_role', 'OWNER');
        applyRoleUi();
        showToast('Вход выполнен: Аккаунт Владельцев');
        document.getElementById('accountModal').classList.remove('active');
      } else {
        if (pinErr) pinErr.style.display = 'block';
        showToast('Неверный код доступа');
        if (pinInput) pinInput.focus();
      }
    });
  }

  const ownerPinInp = document.getElementById('ownerPinInput');
  if (ownerPinInp) {
    ownerPinInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const btn = document.getElementById('btnSubmitAdminPin');
        if (btn) btn.click();
      }
    });
  }

  const btnSaveAgent = document.getElementById('btnSaveAgentName');
  if (btnSaveAgent) {
    btnSaveAgent.addEventListener('click', () => {
      const inp = document.getElementById('accountAgentNameInput');
      const val = (inp ? inp.value : '').trim() || 'Javohir';
      currentAgentName = val;
      localStorage.setItem('asorti_agent_name', val);
      const stepInput = document.getElementById('agentNameInput');
      if (stepInput) stepInput.value = val;
      applyRoleUi();
      showToast('Имя сохранено: ' + val);
      document.getElementById('accountModal').classList.remove('active');
    });
  }

  const btnExitAdmin = document.getElementById('btnExitAdminMode');
  if (btnExitAdmin) {
    btnExitAdmin.addEventListener('click', () => {
      currentRole = 'AGENT';
      localStorage.setItem('asorti_user_role', 'AGENT');
      applyRoleUi();
      showToast('Активирован аккаунт Агента (себестоимость скрыта)');
      document.getElementById('accountModal').classList.remove('active');
    });
  }

  const btnCloseSetLocation = document.getElementById('btnCloseSetOrderLocationModal');
  if (btnCloseSetLocation) {
    btnCloseSetLocation.addEventListener('click', () => {
      document.getElementById('setOrderLocationModal').classList.remove('active');
    });
  }

  const btnSaveLoc = document.getElementById('btnSaveOrderLocation');
  if (btnSaveLoc) {
    btnSaveLoc.addEventListener('click', saveOrderLocation);
  }

  const btnSearchLoc = document.getElementById('btnSearchSetOrderLocation');
  if (btnSearchLoc) {
    btnSearchLoc.addEventListener('click', searchAddressSetLocation);
  }
  const searchLocInp = document.getElementById('setOrderLocationSearchInput');
  if (searchLocInp) {
    searchLocInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchAddressSetLocation();
      }
    });
  }

  const agentNameInput = document.getElementById('agentNameInput');
  if (agentNameInput) {
    agentNameInput.addEventListener('input', () => {
      const val = agentNameInput.value.trim();
      if (val) {
        currentAgentName = val;
        localStorage.setItem('asorti_agent_name', val);
        applyRoleUi();
      }
    });
  }

  const btnOpenMapCtrl = document.getElementById('btnOpenMapFromControl');
  if (btnOpenMapCtrl) {
    btnOpenMapCtrl.addEventListener('click', () => {
      switchTab('tab-map');
    });
  }

  const mapDateInput = document.getElementById('mapDateInput');
  if (mapDateInput) {
    mapDateInput.addEventListener('change', () => {
      selectedDeliveryDate = mapDateInput.value;
      renderDeliveryRouteMap();
    });
  }

  const btnMapPrev = document.getElementById('btnMapPrevDate');
  if (btnMapPrev) {
    btnMapPrev.addEventListener('click', () => {
      if (!selectedDeliveryDate) selectedDeliveryDate = getTodayDate();
      const d = new Date(selectedDeliveryDate);
      d.setDate(d.getDate() - 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      selectedDeliveryDate = yyyy + '-' + mm + '-' + dd;
      if (mapDateInput) mapDateInput.value = selectedDeliveryDate;
      renderDeliveryRouteMap();
    });
  }

  const btnMapNext = document.getElementById('btnMapNextDate');
  if (btnMapNext) {
    btnMapNext.addEventListener('click', () => {
      if (!selectedDeliveryDate) selectedDeliveryDate = getTodayDate();
      const d = new Date(selectedDeliveryDate);
      d.setDate(d.getDate() + 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      selectedDeliveryDate = yyyy + '-' + mm + '-' + dd;
      if (mapDateInput) mapDateInput.value = selectedDeliveryDate;
      renderDeliveryRouteMap();
    });
  }

  const btnMapToday = document.getElementById('btnMapTodayDate');
  if (btnMapToday) {
    btnMapToday.addEventListener('click', () => {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      selectedDeliveryDate = yyyy + '-' + mm + '-' + dd;
      if (mapDateInput) mapDateInput.value = selectedDeliveryDate;
      renderDeliveryRouteMap();
    });
  }

  const btnOptimize = document.getElementById('btnOptimizeRoute');
  if (btnOptimize) {
    btnOptimize.addEventListener('click', optimizeDeliveryRoute);
  }
}

function initUserRoles() {
  applyRoleUi();
}

function applyRoleUi() {
  const badgeBtn = document.getElementById('btnAccountSwitcher');
  const badgeText = document.getElementById('accountBadgeText');
  const badgeIcon = document.getElementById('accountBadgeIcon');
  const agentInput = document.getElementById('agentNameInput');
  const badgeOwnerActive = document.getElementById('badgeOwnerActive');
  const badgeAgentActive = document.getElementById('badgeAgentActive');
  const ownerLoggedOutView = document.getElementById('ownerLoggedOutView');
  const ownerLoggedInView = document.getElementById('ownerLoggedInView');

  if (currentRole === 'OWNER') {
    document.body.classList.remove('role-agent');
    document.body.classList.add('role-owner');
    if (badgeBtn) {
      badgeBtn.classList.remove('is-agent');
      badgeBtn.classList.add('is-owner');
      badgeBtn.title = 'Аккаунт: Владельцы фирмы (3 учредителя)';
    }
    if (badgeText) badgeText.innerText = 'Владельцы';
    if (badgeIcon) {
      badgeIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
    }
    if (badgeOwnerActive) badgeOwnerActive.style.display = 'inline-block';
    if (badgeAgentActive) badgeAgentActive.style.display = 'none';
    if (ownerLoggedOutView) ownerLoggedOutView.style.display = 'none';
    if (ownerLoggedInView) ownerLoggedInView.style.display = 'block';
  } else {
    document.body.classList.remove('role-owner');
    document.body.classList.add('role-agent');
    if (badgeBtn) {
      badgeBtn.classList.remove('is-owner');
      badgeBtn.classList.add('is-agent');
      badgeBtn.title = 'Аккаунт: Торговый агент';
    }
    if (badgeText) badgeText.innerText = 'Агент: ' + (currentAgentName || 'Javohir');
    if (badgeIcon) {
      badgeIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    if (badgeOwnerActive) badgeOwnerActive.style.display = 'none';
    if (badgeAgentActive) badgeAgentActive.style.display = 'inline-block';
    if (ownerLoggedOutView) ownerLoggedOutView.style.display = 'block';
    if (ownerLoggedInView) ownerLoggedInView.style.display = 'none';
  }

  if (agentInput && (!agentInput.value || agentInput.value === 'Javohir')) {
    agentInput.value = currentAgentName || 'Javohir';
  }
}

function openAccountModal() {
  const modal = document.getElementById('accountModal');
  const agentNameInput = document.getElementById('accountAgentNameInput');
  const ownerPinInput = document.getElementById('ownerPinInput');
  const ownerPinError = document.getElementById('ownerPinError');

  if (agentNameInput) agentNameInput.value = currentAgentName || 'Javohir';
  if (ownerPinInput) ownerPinInput.value = '';
  if (ownerPinError) ownerPinError.style.display = 'none';

  applyRoleUi();
  modal.classList.add('active');
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function solveNearestNeighborTsp(points) {
  if (points.length <= 1) return points.slice();
  const unvisited = points.slice();
  const route = [];
  const baseLat = 41.3111;
  const baseLng = 69.2797;

  let currentLat = baseLat;
  let currentLng = baseLng;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const p = unvisited[i];
      const pLat = (p.coords && p.coords.lat) ? Number(p.coords.lat) : baseLat;
      const pLng = (p.coords && p.coords.lng) ? Number(p.coords.lng) : baseLng;
      const dist = calculateHaversineDistance(currentLat, currentLng, pLat, pLng);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = i;
      }
    }
    const [nextStop] = unvisited.splice(nearestIdx, 1);
    route.push(nextStop);
    currentLat = (nextStop.coords && nextStop.coords.lat) ? Number(nextStop.coords.lat) : baseLat;
    currentLng = (nextStop.coords && nextStop.coords.lng) ? Number(nextStop.coords.lng) : baseLng;
  }
  return route;
}

function initDeliveryMap() {
  const mapInput = document.getElementById('mapDateInput');
  if (mapInput && !mapInput.value) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    selectedDeliveryDate = yyyy + '-' + mm + '-' + dd;
    mapInput.value = selectedDeliveryDate;
  }
}

function renderDeliveryRouteMap() {
  const mapInput = document.getElementById('mapDateInput');
  if (mapInput && mapInput.value) {
    selectedDeliveryDate = mapInput.value;
  } else if (!selectedDeliveryDate) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    selectedDeliveryDate = yyyy + '-' + mm + '-' + dd;
    if (mapInput) mapInput.value = selectedDeliveryDate;
  }

  const dayOrders = allOrders.filter(o => o.deliveryDate === selectedDeliveryDate && o.status !== 'deleted');

  const statTotal = document.getElementById('mapStatTotal');
  const statPlanned = document.getElementById('mapStatPlanned');
  const statDelivered = document.getElementById('mapStatDelivered');
  const statCancelled = document.getElementById('mapStatCancelled');
  const statSum = document.getElementById('mapStatSum');

  const countTotal = dayOrders.length;
  const countPlanned = dayOrders.filter(o => o.status === 'planned' || !o.status).length;
  const countDelivered = dayOrders.filter(o => o.status === 'delivered').length;
  const countCancelled = dayOrders.filter(o => o.status === 'cancelled').length;
  const sumTotal = dayOrders.reduce((acc, o) => acc + (Number(o.totalAmount) || 0), 0);

  if (statTotal) statTotal.innerText = '' + countTotal;
  if (statPlanned) statPlanned.innerText = '' + countPlanned;
  if (statDelivered) statDelivered.innerText = '' + countDelivered;
  if (statCancelled) statCancelled.innerText = '' + countCancelled;
  if (statSum) statSum.innerText = formatPrice(sumTotal) + ' сум';

  const routeInfo = document.getElementById('routeInfoBanner');
  if (routeInfo) routeInfo.style.display = 'none';
  const btnMultiYandex = document.getElementById('btnOpenYandexRouteMulti');
  if (btnMultiYandex) btnMultiYandex.style.display = 'none';

  if (!deliveryMapInstance) {
    deliveryMapInstance = L.map('deliveryMainMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([41.3111, 69.2797], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(deliveryMapInstance);

    deliveryMarkersLayer = L.layerGroup().addTo(deliveryMapInstance);
  } else {
    deliveryMarkersLayer.clearLayers();
    if (deliveryRoutePolyline) {
      deliveryMapInstance.removeLayer(deliveryRoutePolyline);
      deliveryRoutePolyline = null;
    }
  }

  const ordersWithCoords = dayOrders.filter(o => o.coords && o.coords.lat && o.coords.lng && !isNaN(Number(o.coords.lat)) && !isNaN(Number(o.coords.lng)));
  const ordersWithoutCoords = dayOrders.filter(o => !o.coords || !o.coords.lat || !o.coords.lng || isNaN(Number(o.coords.lat)) || isNaN(Number(o.coords.lng)));

  currentRouteStops = ordersWithCoords.slice();
  renderMarkersAndStopList(ordersWithCoords, ordersWithoutCoords, false);

  setTimeout(() => {
    if (deliveryMapInstance) deliveryMapInstance.invalidateSize();
  }, 200);
}

function renderMarkersAndStopList(ordersWithCoords, ordersWithoutCoords, isOptimized) {
  if (!deliveryMarkersLayer) return;
  deliveryMarkersLayer.clearLayers();

  const bounds = [];

  ordersWithCoords.forEach((order, idx) => {
    const lat = Number(order.coords.lat);
    const lng = Number(order.coords.lng);
    bounds.push([lat, lng]);

    const seqNum = idx + 1;
    const statusClass = order.status === 'delivered' ? 'status-delivered' :
      (order.status === 'cancelled' ? 'status-cancelled' : 'status-planned');

    const iconHtml = '<div class="map-order-pin ' + statusClass + '">' +
      '<span class="pin-number">' + seqNum + '</span>' +
      '</div>';

    const customIcon = L.divIcon({
      className: 'custom-order-div-icon',
      html: iconHtml,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(deliveryMarkersLayer);

    const popupHtml = '<div style="min-width: 190px; font-family: Inter, sans-serif;">' +
      '<div style="font-size: 11px; color: #64748b;">Точка #' + seqNum + ' &bull; № ' + order.orderNumber + '</div>' +
      '<div style="font-weight: 800; font-size: 14px; color: #003366; margin: 2px 0;">' + order.storeName + '</div>' +
      (order.ownerName ? '<div style="font-size: 11px; color: #0066cc;">Владелец: ' + order.ownerName + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : '') + '</div>' : '') +
      '<div style="font-size: 11px; color: #334155; margin: 2px 0;">' + (order.address || 'Адрес не указан') + '</div>' +
      '<div style="font-weight: 800; font-size: 13px; color: #003366; margin: 4px 0;">Сумма: ' + formatPrice(order.totalAmount) + ' сум</div>' +
      '<div style="display: flex; gap: 4px; margin: 6px 0;">' +
      '<button type="button" class="btn-step" style="font-size: 10px; padding: 3px 6px;" onclick="updateOrderStatusFromMap(\'' + order.id + '\', \'planned\')">Ожидание</button>' +
      '<button type="button" class="btn-step" style="font-size: 10px; padding: 3px 6px; color: #166534;" onclick="updateOrderStatusFromMap(\'' + order.id + '\', \'delivered\')">&check; Сдано</button>' +
      '<button type="button" class="btn-step" style="font-size: 10px; padding: 3px 6px; color: #ef4444;" onclick="updateOrderStatusFromMap(\'' + order.id + '\', \'cancelled\')">&times; Отклонить</button>' +
      '</div>' +
      '<div style="display: flex; gap: 4px; margin-top: 6px;">' +
      '<button type="button" class="btn-step add-first" style="font-size: 10px; padding: 3px 8px; flex: 1;" onclick="openOrderModalById(\'' + order.id + '\')">Открыть заказ</button>' +
      '<button type="button" class="btn-yandex-nav" style="font-size: 10px; padding: 3px 6px; border: none; cursor: pointer;" onclick="openInNavigator(\'' + lat + '\', \'' + lng + '\', \'' + sanitizeXml(order.storeName) + '\')">Навигатор</button>' +
      '</div>' +
      '</div>';

    marker.bindPopup(popupHtml);
  });

  if (bounds.length > 0 && deliveryMapInstance) {
    if (bounds.length === 1) {
      deliveryMapInstance.setView(bounds[0], 15);
    } else {
      deliveryMapInstance.fitBounds(bounds, { padding: [30, 30] });
    }
  } else if (deliveryMapInstance) {
    deliveryMapInstance.setView([41.3111, 69.2797], 12);
  }

  const listContainer = document.getElementById('mapOrdersList');
  if (listContainer) {
    let html = '';

    if (ordersWithCoords.length > 0) {
      html += '<div class="map-section-divider"><span>Маршрут доставки (' + ordersWithCoords.length + ' точек с геометкой):</span></div>';
      html += ordersWithCoords.map((order, idx) => {
        const seqNum = idx + 1;
        const statusClass = order.status === 'delivered' ? 'color: var(--success); font-weight: 700;' :
          (order.status === 'cancelled' ? 'color: var(--danger); font-weight: 700;' : 'color: #92400e; font-weight: 600;');
        const statusText = order.status === 'delivered' ? 'Сдано' :
          (order.status === 'cancelled' ? 'Отклонено' : 'Ожидание');
        const lat = Number(order.coords.lat);
        const lng = Number(order.coords.lng);

        return '<div class="map-order-row-card">' +
          '<div style="display: flex; align-items: center; gap: 10px;">' +
          '<div class="map-order-seq-num">' + seqNum + '</div>' +
          '<div>' +
          '<div style="font-weight: 700; font-size: 13px; color: var(--primary-navy);">' + order.storeName + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted);">' + (order.address || 'Адрес не указан') + ' &bull; № ' + order.orderNumber + '</div>' +
          '<div style="font-size: 11px; ' + statusClass + '">' + statusText + ' &bull; ' + formatPrice(order.totalAmount) + ' сум</div>' +
          '</div>' +
          '</div>' +
          '<div style="display: flex; gap: 6px;">' +
          '<button type="button" class="btn-step" style="font-size: 11px; padding: 4px 8px;" onclick="openOrderModalById(\'' + order.id + '\')">Детали</button>' +
          '<button type="button" class="btn-yandex-nav" style="font-size: 11px; padding: 4px 8px; border: none; cursor: pointer;" onclick="openInNavigator(\'' + lat + '\', \'' + lng + '\', \'' + sanitizeXml(order.storeName) + '\')">Навигатор</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }

    if (ordersWithoutCoords.length > 0) {
      html += '<div class="map-section-divider"><span style="color: #b45309;">Заказы без геометки (' + ordersWithoutCoords.length + '):</span><span style="font-size: 11px; font-weight: 500; color: #92400e;">Точка не указана</span></div>';
      html += ordersWithoutCoords.map(order => {
        return '<div class="map-no-coords-card">' +
          '<div>' +
          '<div style="font-weight: 700; font-size: 13px; color: var(--primary-navy);">' + order.storeName + '</div>' +
          '<div style="font-size: 11px; color: var(--text-muted);">' + (order.address || 'Адрес не указан') + ' &bull; № ' + order.orderNumber + '</div>' +
          '<div style="font-size: 11px; color: #b45309; font-weight: 600;">Локация не задана &bull; ' + formatPrice(order.totalAmount) + ' сум</div>' +
          '</div>' +
          '<div style="display: flex; gap: 6px;">' +
          '<button type="button" class="btn-step" style="font-size: 11px; padding: 4px 8px;" onclick="openOrderModalById(\'' + order.id + '\')">Детали</button>' +
          '<button type="button" class="btn-set-coords" onclick="openSetOrderLocationModal(\'' + order.id + '\')">Указать точку</button>' +
          '</div>' +
          '</div>';
      }).join('');
    }

    if (!ordersWithCoords.length && !ordersWithoutCoords.length) {
      html = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;">На выбранную дату нет активных заказов</div>';
    }

    listContainer.innerHTML = html;
  }
}

function optimizeDeliveryRoute() {
  const dayOrders = allOrders.filter(o => o.deliveryDate === selectedDeliveryDate && o.status !== 'deleted');
  const ordersWithCoords = dayOrders.filter(o => o.coords && o.coords.lat && o.coords.lng && !isNaN(Number(o.coords.lat)) && !isNaN(Number(o.coords.lng)));
  const ordersWithoutCoords = dayOrders.filter(o => !o.coords || !o.coords.lat || !o.coords.lng || isNaN(Number(o.coords.lat)) || isNaN(Number(o.coords.lng)));

  if (ordersWithCoords.length <= 1) {
    showToast('Для построения маршрута нужно минимум 2 заказа с геометкой');
    return;
  }

  showToast('Построение оптимального маршрута...');
  const optimized = solveNearestNeighborTsp(ordersWithCoords);
  currentRouteStops = optimized;

  renderMarkersAndStopList(currentRouteStops, ordersWithoutCoords, true);

  const latlngs = currentRouteStops.map(o => [Number(o.coords.lat), Number(o.coords.lng)]);

  if (deliveryRoutePolyline) {
    deliveryMapInstance.removeLayer(deliveryRoutePolyline);
  }

  deliveryRoutePolyline = L.polyline(latlngs, {
    color: '#0066cc',
    weight: 4,
    opacity: 0.85,
    dashArray: '6, 6'
  }).addTo(deliveryMapInstance);

  let totalKm = 0;
  for (let i = 0; i < latlngs.length - 1; i++) {
    totalKm += calculateHaversineDistance(latlngs[i][0], latlngs[i][1], latlngs[i + 1][0], latlngs[i + 1][1]);
  }

  const routeInfo = document.getElementById('routeInfoBanner');
  const routeDistText = document.getElementById('routeDistanceText');
  const routeCountText = document.getElementById('routePointsCountText');

  if (routeInfo) routeInfo.style.display = 'block';
  if (routeDistText) routeDistText.innerText = totalKm.toFixed(1) + ' км';
  if (routeCountText) routeCountText.innerText = latlngs.length + ' точек';

  const btnMultiYandex = document.getElementById('btnOpenYandexRouteMulti');
  if (btnMultiYandex) {
    btnMultiYandex.style.display = 'inline-flex';
    btnMultiYandex.href = 'https://yandex.ru/maps/?rtext=' + latlngs.map(p => p[0] + ',' + p[1]).join('~') + '&rtt=auto';
  }

  showToast('Оптимальный маршрут построен: ' + totalKm.toFixed(1) + ' км');
}

let setLocationMapInstance = null;
let setLocationMarker = null;
let setLocationOrderId = null;
let setLocationCoords = null;
let setLocationAddress = '';

window.openSetOrderLocationModal = function(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  setLocationOrderId = orderId;
  const modal = document.getElementById('setOrderLocationModal');
  const title = document.getElementById('setOrderLocationTitle');
  const sub = document.getElementById('setOrderLocationSub');
  const addrInp = document.getElementById('setOrderLocationAddressInput');
  const searchInp = document.getElementById('setOrderLocationSearchInput');

  if (title) title.innerText = 'Точка магазина: ' + order.storeName;
  if (sub) sub.innerText = 'Накладная № ' + order.orderNumber + ' (' + (order.address || 'Адрес не указан') + ')';
  if (addrInp) addrInp.value = order.address || '';
  if (searchInp) searchInp.value = order.address || order.storeName || '';

  const initialLat = (order.coords && order.coords.lat && !isNaN(Number(order.coords.lat))) ? Number(order.coords.lat) : 41.3111;
  const initialLng = (order.coords && order.coords.lng && !isNaN(Number(order.coords.lng))) ? Number(order.coords.lng) : 69.2797;
  setLocationCoords = { lat: initialLat, lng: initialLng };
  setLocationAddress = order.address || '';

  modal.classList.add('active');

  setTimeout(() => {
    if (!setLocationMapInstance) {
      setLocationMapInstance = L.map('setOrderLocationMap', {
        zoomControl: true,
        attributionControl: false
      }).setView([initialLat, initialLng], 14);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(setLocationMapInstance);

      setLocationMarker = L.marker([initialLat, initialLng], { draggable: true }).addTo(setLocationMapInstance);

      setLocationMarker.on('dragend', async (e) => {
        const pos = e.target.getLatLng();
        setLocationCoords = { lat: pos.lat, lng: pos.lng };
        await reverseGeocodeSetLocation(pos.lat, pos.lng);
      });

      setLocationMapInstance.on('click', async (e) => {
        const pos = e.latlng;
        setLocationMarker.setLatLng(pos);
        setLocationCoords = { lat: pos.lat, lng: pos.lng };
        await reverseGeocodeSetLocation(pos.lat, pos.lng);
      });
    } else {
      setLocationMapInstance.setView([initialLat, initialLng], 14);
      setLocationMarker.setLatLng([initialLat, initialLng]);
      setLocationMapInstance.invalidateSize();
    }
  }, 200);
};

async function reverseGeocodeSetLocation(lat, lon) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&accept-language=ru';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (data && data.display_name) {
      const parts = (data.display_name || '').split(',').slice(0, 4).join(',');
      setLocationAddress = parts;
      const addrInp = document.getElementById('setOrderLocationAddressInput');
      if (addrInp) addrInp.value = parts;
    }
  } catch (e) {}
}

async function searchAddressSetLocation() {
  const searchInp = document.getElementById('setOrderLocationSearchInput');
  const q = (searchInp ? searchInp.value : '').trim();
  if (!q) return;
  showToast('Поиск: ' + q + '...');
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent('Ташкент ' + q) + '&viewbox=69.05,41.45,69.45,41.15&bounded=0&limit=1&accept-language=ru';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (data && data.length > 0) {
      const item = data[0];
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      setLocationCoords = { lat, lng: lon };
      const parts = (item.display_name || '').split(',').slice(0, 4).join(',');
      setLocationAddress = q + ' (' + parts + ')';
      const addrInp = document.getElementById('setOrderLocationAddressInput');
      if (addrInp) addrInp.value = setLocationAddress;
      if (setLocationMapInstance && setLocationMarker) {
        setLocationMapInstance.setView([lat, lon], 15);
        setLocationMarker.setLatLng([lat, lon]);
      }
      showToast('Точка найдена');
    } else {
      showToast('Адрес не найден, укажите магазин кликом на карте');
    }
  } catch (e) {
    showToast('Ошибка поиска адреса');
  }
}

async function saveOrderLocation() {
  if (!setLocationOrderId || !setLocationCoords) return;
  const order = allOrders.find(o => o.id === setLocationOrderId);
  if (!order) return;
  const addrInp = document.getElementById('setOrderLocationAddressInput');
  const finalAddr = (addrInp ? addrInp.value : '').trim() || order.address || 'г. Ташкент';

  order.coords = { lat: setLocationCoords.lat, lng: setLocationCoords.lng };
  order.address = finalAddr;

  try {
    if (supabaseClient) {
      await supabaseClient
        .from('orders')
        .update({
          coords: order.coords,
          address: finalAddr
        })
        .eq('id', order.id);
    }
    showToast('Геоточка сохранена для ' + order.storeName);
    document.getElementById('setOrderLocationModal').classList.remove('active');
    renderDeliveryRouteMap();
    renderControlOrders();
    renderHistoryOrders();
    if (selectedOrder && selectedOrder.id === order.id) {
      openOrderModal(order);
    }
  } catch (err) {
    console.error('Error saving order location:', err);
    showToast('Ошибка сохранения: ' + err.message);
  }
}

window.openOrderModalById = function (orderId) {
  const o = allOrders.find(item => item.id === orderId);
  if (o) openOrderModal(o);
};

window.updateOrderStatusFromMap = async function (orderId, newStatus) {
  const o = allOrders.find(item => item.id === orderId);
  if (!o) return;
  selectedOrder = o;
  await updateOrderStatus(newStatus);
  renderDeliveryRouteMap();
};

function buildSingleCostTableXml(order) {
  const orderNumber = sanitizeXml(order.orderNumber || '000001');
  const deliveryDate = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('/') : '00/00/0000';
  const clientName = sanitizeXml(order.storeName || 'Магазин');
  const ownerText = (order.ownerName || order.ownerPhone)
    ? sanitizeXml('Владелец: ' + (order.ownerName || '-') + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : ''))
    : '';
  const address = sanitizeXml(order.address || 'г. Ташкент');
  const agentName = sanitizeXml(order.agentName || 'Javohir');

  let totalSelling = 0;
  let totalCost = 0;
  let rowsXml = '';

  (order.items || []).forEach(item => {
    const name = sanitizeXml(item.fullName || item.name || '') + (item.colorText ? ' (Цвета: ' + sanitizeXml(item.colorText) + ')' : '');
    const vol = sanitizeXml(item.volume || '-');
    const qty = Number(item.quantity) || 1;
    const sellPrice = Number(item.price) || 0;

    let costPrice = Number(item.costPrice);
    if (!costPrice || isNaN(costPrice)) {
      const found = allProducts.find(p => p.id === item.id || p.fullName === item.fullName);
      costPrice = found ? Number(found.costPrice) || 0 : 0;
    }

    const sellSum = qty * sellPrice;
    const costSum = qty * costPrice;
    const marginSum = sellSum - costSum;

    totalSelling += sellSum;
    totalCost += costSum;

    rowsXml += '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + name + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + vol + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + qty + ' шт</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + formatPrice(sellPrice) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="15803D"/></w:rPr><w:t>' + formatPrice(costPrice) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="15803D"/></w:rPr><w:t>' + formatPrice(costSum) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="003366"/></w:rPr><w:t>+' + formatPrice(marginSum) + '</w:t></w:r></w:p></w:tc>' +
      '</w:tr>';
  });

  const totalMargin = totalSelling - totalCost;

  return '<w:tbl>' +
    '<w:tblPr>' +
    '<w:tblW w:w="10200" w:type="dxa"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:left w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:right w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '</w:tblBorders>' +
    '<w:jc w:val="center"/>' +
    '</w:tblPr>' +
    '<w:tr>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="5300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="22"/></w:rPr><w:t>ОТЧЁТ ПО СЕБЕСТОИМОСТИ № ' + orderNumber + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Дата: ' + deliveryDate + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr>' +
    '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>ASORTI TRADE PLUS</w:t></w:r></w:p>' +
    '</w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="5300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ОРГАНИЗАЦИЯ / АГЕНТ:</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="20"/><w:color w:val="166534"/></w:rPr><w:t>OOO "ASORTI TRADE PLUS"</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Агент: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + agentName + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '<w:tc>' +
    '<w:tcPr><w:gridSpan w:val="4"/><w:tcW w:w="4900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ТОЧКА СБЫТА (МАГАЗИН):</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="22"/><w:color w:val="111827"/></w:rPr><w:t>' + clientName + '</w:t></w:r></w:p>' +
    (ownerText ? '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="166534"/></w:rPr><w:t>' + ownerText + '</w:t></w:r></w:p>' : '') +
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Адрес: </w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>' + address + '</w:t></w:r></w:p>' +
    '</w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ТОВАР</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ОБЪЁМ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>КОЛ-ВО</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ПРОДАЖА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>СЕБЕСТ.</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>СУММА СЕБ.</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>МАРЖА</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    rowsXml +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="5300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="166534"/></w:rPr><w:t>ИТОГИ ПО ЗАКАЗУ: </w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>Сумма реализации: ' + formatPrice(totalSelling) + ' сум</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="15803D"/><w:sz w:val="18"/></w:rPr><w:t>Себест.: ' + formatPrice(totalCost) + ' сум</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="20"/></w:rPr><w:t>Маржа: +' + formatPrice(totalMargin) + ' сум</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>';
}

async function generateCostDocxBlob(orders) {
  if (!Array.isArray(orders)) orders = [orders];
  if (!window.JSZip || !window.TEMPLATE_DOCX_B64) {
    throw new Error('JSZip or template not loaded');
  }

  const zip = await window.JSZip.loadAsync(window.TEMPLATE_DOCX_B64, { base64: true });
  let combinedTablesXml = '';

  let grandSelling = 0;
  let grandCost = 0;

  orders.forEach((order, idx) => {
    (order.items || []).forEach(item => {
      const qty = Number(item.quantity) || 1;
      const sellPrice = Number(item.price) || 0;
      let costPrice = Number(item.costPrice);
      if (!costPrice || isNaN(costPrice)) {
        const found = allProducts.find(p => p.id === item.id || p.fullName === item.fullName);
        costPrice = found ? Number(found.costPrice) || 0 : 0;
      }
      grandSelling += (qty * sellPrice);
      grandCost += (qty * costPrice);
    });

    combinedTablesXml += buildSingleCostTableXml(order);
    if (idx < orders.length - 1) {
      combinedTablesXml += '<w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="dashed" w:sz="6" w:space="4" w:color="166534"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:i/><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t></w:t></w:r></w:p>';
      combinedTablesXml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
  });

  if (orders.length > 1) {
    const grandMargin = grandSelling - grandCost;
    combinedTablesXml += '<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="166534"/></w:rPr><w:t>ИТОГОВЫЙ СВОД ПО СЕБЕСТОИМОСТИ ЗА ДЕНЬ (' + orders.length + ' НАКЛАДНЫХ):</w:t></w:r></w:p>';
    combinedTablesXml += '<w:tbl>' +
      '<w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="166534"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="166534"/><w:left w:val="none"/><w:right w:val="none"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>' +
      '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr><w:t>ОБЩАЯ РЕАЛИЗАЦИЯ (ПРОДАЖА):</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="003366"/></w:rPr><w:t>' + formatPrice(grandSelling) + ' сум</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr><w:t>ОБЩАЯ СЕБЕСТОИМОСТЬ:</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="15803D"/></w:rPr><w:t>' + formatPrice(grandCost) + ' сум</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="166534"/></w:rPr><w:t>ВАЛОВАЯ МАРЖА (ПРИБЫЛЬ):</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="166534"/></w:rPr><w:t>+' + formatPrice(grandMargin) + ' сум</w:t></w:r></w:p></w:tc>' +
      '</w:tr>' +
      '</w:tbl>';
  }

  const bodyXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' +
    combinedTablesXml +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body>' +
    '</w:document>';

  zip.file('word/document.xml', bodyXml);
  return await zip.generateAsync({ type: 'blob' });
}

async function downloadOrderCostDocx() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  if (!selectedOrder) return;
  showToast('Формирование отчёта себестоимости...');
  try {
    const blob = await generateCostDocxBlob([selectedOrder]);
    const fileName = 'Себестоимость_№' + selectedOrder.orderNumber + '.docx';
    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    showToast('DOCX отчёт по себестоимости скачан!');
  } catch (err) {
    console.error('Cost report error:', err);
    alert('Ошибка отчёта: ' + err.message);
  }
}

async function shareOrderCostToTelegram() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  if (!selectedOrder) return;
  const o = selectedOrder;
  const cisFormatted = o.deliveryDate ? o.deliveryDate.split('-').reverse().join('.') : '-';

  let totalSelling = 0;
  let totalCost = 0;
  (o.items || []).forEach(it => {
    const qty = Number(it.quantity) || 1;
    const sellPrice = Number(it.price) || 0;
    let costPrice = Number(it.costPrice);
    if (!costPrice || isNaN(costPrice)) {
      const found = allProducts.find(p => p.id === it.id || p.fullName === it.fullName);
      costPrice = found ? Number(found.costPrice) || 0 : 0;
    }
    totalSelling += (qty * sellPrice);
    totalCost += (qty * costPrice);
  });

  const totalMargin = totalSelling - totalCost;

  let text = 'ОТЧЁТ ПО СЕБЕСТОИМОСТИ № ' + o.orderNumber + '\n' +
    'Магазин: ' + o.storeName + '\n' +
    (o.ownerName || o.ownerPhone ? 'Владелец: ' + (o.ownerName || '-') + (o.ownerPhone ? ' (' + o.ownerPhone + ')' : '') + '\n' : '') +
    'Дата: ' + cisFormatted + '\n' +
    'Адрес: ' + (o.address || 'г. Ташкент') + '\n\n' +
    'Реализация: ' + formatPrice(totalSelling) + ' сум\n' +
    'Себестоимость: ' + formatPrice(totalCost) + ' сум\n' +
    'Маржа (Прибыль): +' + formatPrice(totalMargin) + ' сум\n\n' +
    'ASORTI TRADE PLUS';

  showToast('Подготовка отчёта по себестоимости...');

  try {
    const blob = await generateCostDocxBlob([o]);
    const fileName = 'Себестоимость_№' + o.orderNumber + '.docx';
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
      const base64Data = await blobToBase64(blob);
      window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
      showToast('Отчёт отправлен в Telegram!');
      return;
    }

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Себестоимость заказа №' + o.orderNumber,
          text: text,
          files: [file]
        });
        showToast('Отчёт успешно отправлен!');
        return;
      }
    }

    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    const tgUrl = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    window.open(tgUrl, '_blank');
    showToast('Отчёт скачан и открыт Telegram');
  } catch (err) {
    console.error('Share cost error:', err);
    alert('Ошибка отправки: ' + err.message);
  }
}

function aggregateOrdersProducts(orders) {
  const map = new Map();

  orders.forEach(order => {
    (order.items || []).forEach(item => {
      const name = item.fullName || item.name || 'Товар';
      const vol = item.volume || '';
      const rawKey = (item.id !== undefined && item.id !== null && item.id !== '') ? item.id : (name + '__' + vol);
      const key = String(rawKey).toLowerCase();

      let costPrice = Number(item.costPrice);
      if (!costPrice || isNaN(costPrice)) {
        const found = allProducts.find(p => String(p.id) === String(item.id) || p.fullName === item.fullName);
        costPrice = found ? Number(found.costPrice) || 0 : 0;
      }
      const sellPrice = Number(item.price) || 0;
      const qty = Number(item.quantity) || 1;

      if (!map.has(key)) {
        map.set(key, {
          id: item.id || key,
          name: name,
          volume: vol,
          quantity: 0,
          costPrice: costPrice,
          sellingPrice: sellPrice,
          totalCost: 0,
          totalSelling: 0,
          colors: {}
        });
      }

      const rec = map.get(key);
      rec.quantity += qty;
      rec.totalCost += (qty * costPrice);
      rec.totalSelling += (qty * sellPrice);

      if (item.colors && typeof item.colors === 'object') {
        Object.keys(item.colors).forEach(cName => {
          const cQty = Number(item.colors[cName]) || 0;
          if (cQty > 0) {
            rec.colors[cName] = (rec.colors[cName] || 0) + cQty;
          }
        });
      } else if (item.colorText && typeof item.colorText === 'string') {
        item.colorText.split(',').forEach(part => {
          const sub = part.split(':');
          if (sub.length === 2) {
            const cName = sub[0].trim();
            const cQty = parseInt(sub[1].trim(), 10) || 0;
            if (cName && cQty > 0) {
              rec.colors[cName] = (rec.colors[cName] || 0) + cQty;
            }
          }
        });
      }
    });
  });

  const list = Array.from(map.values());
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
  return list;
}

function formatAggregatedColors(colors) {
  if (!colors || !Object.keys(colors).length) return '';
  return Object.keys(colors)
    .map(c => c + ': ' + colors[c])
    .join(', ');
}

function buildAsortiCostDocxXml(orders, cisDate) {
  const aggregated = aggregateOrdersProducts(orders);

  let grandSelling = 0;
  let grandCost = 0;
  let grandQty = 0;
  let rowsXml = '';

  aggregated.forEach((item, idx) => {
    const colorText = formatAggregatedColors(item.colors);
    const name = sanitizeXml(item.name) + (colorText ? ' (Цвета: ' + sanitizeXml(colorText) + ')' : '');
    const vol = sanitizeXml(item.volume || '-');
    const qty = item.quantity;
    const costPrice = item.costPrice;
    const costSum = item.totalCost;
    const sellPrice = item.sellingPrice;
    const sellSum = item.totalSelling;
    const marginSum = sellSum - costSum;

    grandQty += qty;
    grandCost += costSum;
    grandSelling += sellSum;

    const bgFill = idx % 2 === 1 ? 'F9FAFB' : 'FFFFFF';

    rowsXml += '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr><w:t>' + (idx + 1) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="3100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:b/></w:rPr><w:t>' + name + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + vol + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="700" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + qty + ' шт</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="15803D"/></w:rPr><w:t>' + formatPrice(costPrice) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="15803D"/></w:rPr><w:t>' + formatPrice(costSum) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>' + formatPrice(sellPrice) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + formatPrice(sellSum) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/><w:color w:val="003366"/></w:rPr><w:t>+' + formatPrice(marginSum) + '</w:t></w:r></w:p></w:tc>' +
      '</w:tr>';
  });

  const grandMargin = grandSelling - grandCost;

  return '<w:tbl>' +
    '<w:tblPr>' +
    '<w:tblW w:w="11200" w:type="dxa"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:left w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:right w:val="single" w:sz="8" w:space="0" w:color="166534"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>' +
    '</w:tblBorders>' +
    '<w:jc w:val="center"/>' +
    '</w:tblPr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="4"/><w:tcW w:w="5100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="22"/></w:rPr><w:t>СВОДНЫЙ ОТЧЁТ СЕБЕСТОИМОСТИ И ПРИБЫЛИ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="3500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Дата: ' + cisDate + ' (Накладных: ' + orders.length + ')</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="166534"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>ASORTI TRADE PLUS</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>№</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="3100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ТОВАР (ВСЕ ЗАКАЗЫ ДНЯ)</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ОБЪЁМ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="700" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>КОЛ-ВО</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ЗАКУПКА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>СУММА ЗАК.</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ПРОДАЖА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>ВЫРУЧКА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="166534"/></w:rPr><w:t>МАРЖА</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    rowsXml +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="4400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="166534"/></w:rPr><w:t>ИТОГО ПО ВСЕМ ТОВАРАМ ДНЯ:</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="700" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="18"/></w:rPr><w:t>' + grandQty + ' шт</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="15803D"/><w:sz w:val="18"/></w:rPr><w:t>Себест.: ' + formatPrice(grandCost) + ' сум</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="003366"/><w:sz w:val="18"/></w:rPr><w:t>Реализ.: ' + formatPrice(grandSelling) + ' сум</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DCFCE7"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="166534"/><w:sz w:val="20"/></w:rPr><w:t>+' + formatPrice(grandMargin) + ' сум</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>';
}

function buildSupplierCostDocxXml(orders, cisDate) {
  const aggregated = aggregateOrdersProducts(orders);

  let grandCost = 0;
  let grandQty = 0;
  let rowsXml = '';

  aggregated.forEach((item, idx) => {
    const colorText = formatAggregatedColors(item.colors);
    const name = sanitizeXml(item.name) + (colorText ? ' (Цвета: ' + sanitizeXml(colorText) + ')' : '');
    const vol = sanitizeXml(item.volume || '-');
    const qty = item.quantity;
    const costPrice = item.costPrice;
    const costSum = item.totalCost;

    grandQty += qty;
    grandCost += costSum;

    const bgFill = idx % 2 === 1 ? 'F8FAFC' : 'FFFFFF';

    rowsXml += '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr><w:t>' + (idx + 1) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="5200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="19"/><w:color w:val="0F172A"/></w:rPr><w:t>' + name + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="334155"/></w:rPr><w:t>' + vol + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="19"/><w:color w:val="0F172A"/></w:rPr><w:t>' + qty + ' шт</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/><w:color w:val="334155"/></w:rPr><w:t>' + formatPrice(costPrice) + '</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="' + bgFill + '"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="19"/><w:color w:val="003366"/></w:rPr><w:t>' + formatPrice(costSum) + '</w:t></w:r></w:p></w:tc>' +
      '</w:tr>';
  });

  return '<w:tbl>' +
    '<w:tblPr>' +
    '<w:tblW w:w="10200" w:type="dxa"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:left w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:right w:val="single" w:sz="8" w:space="0" w:color="003366"/>' +
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>' +
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>' +
    '</w:tblBorders>' +
    '<w:jc w:val="center"/>' +
    '</w:tblPr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="22"/></w:rPr><w:t>ЗАКАЗ ТОВАРОВ ПОСТАВЩИКУ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="3300" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Дата поставки: ' + cisDate + '</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="6"/><w:tcW w:w="10200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:tcPr><w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="475569"/><w:sz w:val="18"/></w:rPr><w:t>Заказчик: </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="20"/><w:color w:val="003366"/></w:rPr><w:t>OOO "ASORTI TRADE PLUS"</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:tcW w:w="500" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>№</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="5200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>НАИМЕНОВАНИЕ ТОВАРА</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>ОБЪЁМ / ВЕС</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>КОЛИЧЕСТВО</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>ЦЕНА ЗАКУПКИ</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="16"/><w:color w:val="1E3A8A"/></w:rPr><w:t>СУММА К ОПЛАТЕ</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    rowsXml +
    '<w:tr>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6900" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="003366"/></w:rPr><w:t>ИТОГО К ЗАКАЗУ И ОПЛАТЕ:</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:tcW w:w="1100" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="003366"/><w:sz w:val="19"/></w:rPr><w:t>' + grandQty + ' шт</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="2200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="003366"/><w:sz w:val="20"/></w:rPr><w:t>' + formatPrice(grandCost) + ' сум</w:t></w:r></w:p></w:tc>' +
    '</w:tr>' +
    '</w:tbl>';
}

async function generateAsortiDailyCostDocxBlob(orders, cisDate) {
  if (!window.JSZip || !window.TEMPLATE_DOCX_B64) {
    throw new Error('JSZip or template not loaded');
  }
  const zip = await window.JSZip.loadAsync(window.TEMPLATE_DOCX_B64, { base64: true });
  const tableXml = buildAsortiCostDocxXml(orders, cisDate);

  const bodyXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' +
    tableXml +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="500" w:right="350" w:bottom="500" w:left="350" w:header="500" w:footer="500" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body>' +
    '</w:document>';

  zip.file('word/document.xml', bodyXml);
  return await zip.generateAsync({ type: 'blob' });
}

async function generateSupplierDailyCostDocxBlob(orders, cisDate) {
  if (!window.JSZip || !window.TEMPLATE_DOCX_B64) {
    throw new Error('JSZip or template not loaded');
  }
  const zip = await window.JSZip.loadAsync(window.TEMPLATE_DOCX_B64, { base64: true });
  const tableXml = buildSupplierCostDocxXml(orders, cisDate);

  const bodyXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' +
    tableXml +
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr>' +
    '</w:body>' +
    '</w:document>';

  zip.file('word/document.xml', bodyXml);
  return await zip.generateAsync({ type: 'blob' });
}

async function downloadBatchCostAsortiDocx() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  const cisDate = d.split('-').reverse().join('.');
  showToast('Генерация отчёта себестоимости ASORTI за ' + cisDate + '...');

  try {
    const blob = await generateAsortiDailyCostDocxBlob(matchingOrders, cisDate);
    const fileName = 'Себестоимость_ASORTI_' + d + '.docx';
    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    showToast('DOCX отчёт ASORTI скачан!');
  } catch (err) {
    console.error('Batch cost download error:', err);
    alert('Ошибка отчёта: ' + err.message);
  }
}

async function shareBatchCostAsortiToTelegram() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  const cisDate = d.split('-').reverse().join('.');
  const aggregated = aggregateOrdersProducts(matchingOrders);

  let grandSelling = 0;
  let grandCost = 0;
  let grandQty = 0;

  let itemsText = '';
  aggregated.forEach((item, idx) => {
    grandQty += item.quantity;
    grandCost += item.totalCost;
    grandSelling += item.totalSelling;

    const colorText = formatAggregatedColors(item.colors);
    const colorSuffix = colorText ? ' (' + colorText + ')' : '';
    const margin = item.totalSelling - item.totalCost;

    itemsText += (idx + 1) + '. ' + item.name + colorSuffix + (item.volume ? ' ' + item.volume : '') + '\n' +
      '   ' + item.quantity + ' шт | Закуп: ' + formatPrice(item.costPrice) + ' (' + formatPrice(item.totalCost) + ')' +
      ' | Прод: ' + formatPrice(item.sellingPrice) + ' (' + formatPrice(item.totalSelling) + ')' +
      ' | Маржа: +' + formatPrice(margin) + ' сум\n';
  });

  const grandMargin = grandSelling - grandCost;

  let text = 'СВОДНЫЙ ОТЧЁТ ASORTI ЗА ' + cisDate + '\n' +
    'Всего накладных: ' + matchingOrders.length + '\n\n' +
    'СПИСОК ВСЕХ ТОВАРОВ НА ДЕНЬ:\n' +
    itemsText +
    '────────────────────\n' +
    'Позиций: ' + aggregated.length + ' | Всего товаров: ' + grandQty + ' шт\n' +
    'Общая себестоимость: ' + formatPrice(grandCost) + ' сум\n' +
    'Общая реализация: ' + formatPrice(grandSelling) + ' сум\n' +
    'ЧИСТАЯ ПРИБЫЛЬ (МАРЖА): +' + formatPrice(grandMargin) + ' сум\n\n' +
    'ASORTI TRADE PLUS';

  showToast('Подготовка отчёта ASORTI для Telegram...');

  try {
    const blob = await generateAsortiDailyCostDocxBlob(matchingOrders, cisDate);
    const fileName = 'Себестоимость_ASORTI_' + d + '.docx';
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
      const base64Data = await blobToBase64(blob);
      window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
      showToast('Отчёт ASORTI отправлен в Telegram!');
      return;
    }

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Сводный отчёт ASORTI за ' + cisDate,
          text: text,
          files: [file]
        });
        showToast('Отчёт успешно отправлен!');
        return;
      }
    }

    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    const tgUrl = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    window.open(tgUrl, '_blank');
    showToast('Отчёт скачан и открыт Telegram');
  } catch (err) {
    console.error('Batch cost share error:', err);
    alert('Ошибка отправки: ' + err.message);
  }
}

async function downloadBatchCostSupplierDocx() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  const cisDate = d.split('-').reverse().join('.');
  showToast('Генерация заказа поставщику за ' + cisDate + '...');

  try {
    const blob = await generateSupplierDailyCostDocxBlob(matchingOrders, cisDate);
    const fileName = 'Заказ_Поставщику_ASORTI_' + d + '.docx';
    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    showToast('DOCX заказ поставщику скачан!');
  } catch (err) {
    console.error('Supplier order download error:', err);
    alert('Ошибка заказа: ' + err.message);
  }
}

async function shareBatchCostSupplierToTelegram() {
  if (currentRole === 'AGENT') {
    showToast('Доступ к себестоимости закрыт для агента');
    return;
  }
  const batchInput = document.getElementById('batchDateInput');
  const d = batchInput ? batchInput.value : '';
  if (!d) {
    alert('Пожалуйста, выберите дату');
    return;
  }

  const matchingOrders = allOrders.filter(o => o.deliveryDate === d);
  if (!matchingOrders.length) {
    alert('На дату ' + d.split('-').reverse().join('.') + ' заказов не найдено');
    return;
  }

  const cisDate = d.split('-').reverse().join('.');
  const aggregated = aggregateOrdersProducts(matchingOrders);

  let grandCost = 0;
  let grandQty = 0;

  let itemsText = '';
  aggregated.forEach((item, idx) => {
    grandQty += item.quantity;
    grandCost += item.totalCost;

    const colorText = formatAggregatedColors(item.colors);
    const colorSuffix = colorText ? ' (' + colorText + ')' : '';

    itemsText += (idx + 1) + '. ' + item.name + colorSuffix + (item.volume ? ' ' + item.volume : '') + '\n' +
      '   ' + item.quantity + ' шт × ' + formatPrice(item.costPrice) + ' = ' + formatPrice(item.totalCost) + ' сум\n';
  });

  let text = 'ЗАКАЗ ТОВАРОВ ПОСТАВЩИКУ\n' +
    'Заказчик: OOO "ASORTI TRADE PLUS"\n' +
    'Дата поставки: ' + cisDate + '\n\n' +
    'СПИСОК ТОВАРОВ К ПОСТАВКЕ:\n' +
    itemsText +
    '────────────────────\n' +
    'Позиций: ' + aggregated.length + ' | Всего товаров: ' + grandQty + ' шт\n' +
    'ОБЩАЯ СУММА К ОПЛАТЕ: ' + formatPrice(grandCost) + ' сум\n\n' +
    'OOO "ASORTI TRADE PLUS"';

  showToast('Подготовка заказа поставщику для Telegram...');

  try {
    const blob = await generateSupplierDailyCostDocxBlob(matchingOrders, cisDate);
    const fileName = 'Заказ_Поставщику_ASORTI_' + d + '.docx';
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
      const base64Data = await blobToBase64(blob);
      window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
      showToast('Заказ поставщику отправлен в Telegram!');
      return;
    }

    if (navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Заказ товаров поставщику на ' + cisDate,
          text: text,
          files: [file]
        });
        showToast('Заказ успешно отправлен!');
        return;
      }
    }

    if (window.saveAs) {
      window.saveAs(blob, fileName);
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
    }
    const tgUrl = 'https://t.me/share/url?url=&text=' + encodeURIComponent(text);
    window.open(tgUrl, '_blank');
    showToast('Заказ скачан и открыт Telegram');
  } catch (err) {
    console.error('Supplier cost share error:', err);
    alert('Ошибка отправки: ' + err.message);
  }
}

const downloadBatchCostDocx = downloadBatchCostAsortiDocx;
const shareBatchCostToTelegram = shareBatchCostAsortiToTelegram;
