let allProducts = [];
let filteredProducts = [];
let cart = [];
let currentCategory = 'ALL';
let currentCoords = null;
let currentAddress = '';
let selectedOrder = null;
let allOrders = [];

let createMap = null;
let createMarker = null;
let modalMap = null;
let modalMarker = null;

const SUPABASE_URL = 'https://yzwwoahgynzvcnsvqmrr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_H2t-F2IAZnKPeMEMFiYH-g_USbzXscM';
let supabaseClient = null;

document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  initDateInputs();
  initNavigation();
  initMapWidgets();
  initGeolocation();
  initOfflineSync();
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
  return {
    id: customId || crypto.randomUUID(),
    order_number: payload.orderNumber,
    delivery_date: payload.deliveryDate,
    store_name: payload.storeName,
    owner_name: payload.ownerName || '',
    owner_phone: payload.ownerPhone || '',
    address: payload.address,
    coords: payload.coords,
    agent_name: payload.agentName || 'Javohir',
    agent_phone: payload.agentPhone || '77 030 32 52',
    status: payload.status || 'planned',
    created_at: payload.createdAt || new Date().toISOString(),
    items: payload.items,
    total_amount: payload.totalAmount
  };
}

function mapFromDb(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    deliveryDate: row.delivery_date,
    storeName: row.store_name,
    ownerName: row.owner_name || '',
    ownerPhone: row.owner_phone || '',
    address: row.address,
    coords: row.coords,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    status: row.status,
    createdAt: row.created_at,
    items: row.items || [],
    totalAmount: row.total_amount
  };
}

function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem('offline_order_queue') || '[]');
  } catch (e) {
    return [];
  }
}

function saveOfflineQueue(q) {
  localStorage.setItem('offline_order_queue', JSON.stringify(q));
}

function getLocalOrders() {
  try {
    return JSON.parse(localStorage.getItem('cached_all_orders') || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalOrders(orders) {
  localStorage.setItem('cached_all_orders', JSON.stringify(orders));
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

function showModalOrderMap(lat, lng) {
  const container = document.getElementById('modalMapBox');
  if (!lat || !lng) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  setTimeout(() => {
    try {
      if (!modalMap) {
        modalMap = L.map('modalOrderMap', {
          zoomControl: true,
          attributionControl: false
        }).setView([lat, lng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(modalMap);

        modalMarker = L.marker([lat, lng]).addTo(modalMap);
      } else {
        modalMap.setView([lat, lng], 15);
        modalMarker.setLatLng([lat, lng]);
      }
      modalMap.invalidateSize();
    } catch (e) {
      console.warn('Modal map error:', e);
    }
  }, 200);
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

function applyLocationUi(lat, lon, addressStr, moveMap = true) {
  const btn = document.getElementById('btnGetLocation');
  const btnText = document.getElementById('btnLocationText');
  const manualInput = document.getElementById('manualAddressInput');
  const yandexBar = document.getElementById('yandexLinksRow');
  const yandexNavBtn = document.getElementById('yandexNavBtn');

  btn.classList.add('active');
  btnText.innerText = '✓ Локация определена';
  manualInput.value = addressStr;
  const detectedBadge = document.getElementById('detectedAddressText');
  if (detectedBadge) {
    detectedBadge.innerText = addressStr;
  }
  currentAddress = addressStr;
  currentCoords = { lat, lng: lon };

  yandexBar.style.display = 'flex';
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

  if (tabId === 'tab-control' || tabId === 'tab-history') {
    loadOrders();
  }
}

function initGeolocation() {
  const btn = document.getElementById('btnGetLocation');
  const btnText = document.getElementById('btnLocationText');
  const manualInput = document.getElementById('manualAddressInput');

  btn.addEventListener('click', () => {
    btnText.innerText = 'Определение координат...';
    btn.classList.remove('active');

    if (!navigator.geolocation) {
      fallbackIpLocation();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        currentCoords = { lat, lng: lon };
        await reverseGeocode(lat, lon);
        setCreateMapLocation(lat, lon);
        showToast('Локация успешно определена с высокой точностью');
      },
      () => {
        fallbackIpLocation();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });

  async function fallbackIpLocation() {
    try {
      const res = await fetch('https://ipapi.co/json/');
      const data = await res.json();
      if (data && data.latitude && data.longitude) {
        const lat = data.latitude;
        const lon = data.longitude;
        currentCoords = { lat, lng: lon };
        currentAddress = (data.city || 'Ташкент') + ', ' + (data.region || '');
        applyLocationUi(lat, lon, currentAddress, true);
        return;
      }
    } catch (e) { }

    const lat = 41.3111;
    const lon = 69.2797;
    currentCoords = { lat, lng: lon };
    currentAddress = 'г. Ташкент';
    applyLocationUi(lat, lon, currentAddress, true);
  }

  manualInput.addEventListener('input', () => {
    currentAddress = manualInput.value.trim();
  });
}

async function loadProducts() {
  if (window.EMBEDDED_PRODUCTS && Array.isArray(window.EMBEDDED_PRODUCTS) && window.EMBEDDED_PRODUCTS.length > 0) {
    allProducts = window.EMBEDDED_PRODUCTS;
    filterAndRenderProducts();
  }

  try {
    const res = await fetch('/api/products');
    if (res.ok) {
      allProducts = await res.json();
      filterAndRenderProducts();
    }
  } catch (err) {
    if (!allProducts.length && window.EMBEDDED_PRODUCTS) {
      allProducts = window.EMBEDDED_PRODUCTS;
      filterAndRenderProducts();
    }
  }
}

function filterAndRenderProducts() {
  const searchInput = document.getElementById('productSearchInput');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  filteredProducts = allProducts.filter(p => {
    const matchCat = (currentCategory === 'ALL') || (p.category === currentCategory);
    const matchSearch = !query ||
      p.fullName.toLowerCase().includes(query) ||
      p.brand.toLowerCase().includes(query) ||
      p.category.toLowerCase().includes(query);
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

    return '<div class="product-row-item">' +
      '<div class="item-left">' +
      '<span class="item-category-tag">' + p.category.split(' ')[0] + '</span>' +
      '<div class="item-title">' + p.fullName + '</div>' +
      '<div class="item-meta">' + (p.volume || '') + ' ' + (p.note ? '• ' + p.note : '') + '</div>' +
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

window.addToCartDirect = function (productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  cart.push({ product: p, quantity: 1 });
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
    trayContainer.innerHTML = cart.map(i =>
      '<div class="cart-tray-row">' +
      '<div class="cart-tray-name">' +
      '<div>' + i.product.fullName + '</div>' +
      '<div class="cart-tray-sub">' + formatPrice(i.product.price) + ' сум/шт</div>' +
      '</div>' +
      '<div class="cart-tray-ctrls">' +
      '<input type="number" min="1" class="cart-tray-qty-input" value="' + i.quantity + '" onchange="setItemCountDirect(' + i.product.id + ', this.value)">' +
      '<div class="cart-tray-price">' + formatPrice(i.quantity * i.product.price) + ' сум</div>' +
      '<button type="button" class="btn-remove-tray" title="Убрать из заказа" onclick="removeFromCart(' + i.product.id + ')">&times;</button>' +
      '</div>' +
      '</div>'
    ).join('');
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

  const orderItems = cart.map(i => ({
    id: i.product.id,
    fullName: i.product.fullName,
    volume: i.product.volume || '-',
    price: Number(i.product.price) || 0,
    costPrice: Number(i.product.costPrice) || 0,
    quantity: Number(i.quantity) || 1
  }));

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
    agentName: 'Javohir',
    agentPhone: '77 030 32 52',
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
      allOrders = rows.map(mapFromDb);
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

function renderControlOrders() {
  const container = document.getElementById('controlOrdersList');
  const countBadge = document.getElementById('controlOrdersCount');
  if (!container) return;

  countBadge.innerText = allOrders.length + ' накладных';

  if (!allOrders.length) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">Нет активных заказов. Создайте заказ на Шаге 1.</div>';
    return;
  }

  container.innerHTML = allOrders.map(order => createOrderCardHtml(order)).join('');
}

function renderHistoryOrders(filterStatus = 'ALL') {
  const container = document.getElementById('historyOrdersList');
  if (!container) return;

  let filtered = allOrders;
  if (filterStatus !== 'ALL') {
    filtered = allOrders.filter(o => o.status === filterStatus);
  }

  if (!filtered.length) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 30px;">В этой категории пока нет заказов.</div>';
    return;
  }

  container.innerHTML = filtered.map(order => createOrderCardHtml(order)).join('');
}

function createOrderCardHtml(order) {
  let badgeClass = 'badge-planned';
  let badgeText = 'В планах';
  if (order.status === 'delivered') {
    badgeClass = 'badge-delivered';
    badgeText = 'Сдан';
  } else if (order.status === 'cancelled') {
    badgeClass = 'badge-cancelled';
    badgeText = 'Отменён';
  }

  const cisFormatted = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('.') : '-';

  return '<div class="order-card">' +
    '<div class="order-card-header">' +
    '<div class="order-num">№ ' + order.orderNumber + '</div>' +
    '<div class="order-date-tag">' + cisFormatted + '</div>' +
    '</div>' +
    '<div class="order-store-title">' + order.storeName + '</div>' +
    '<div class="order-address-text">' + (order.address || 'г. Ташкент') + '</div>' +
    '<div class="order-card-footer">' +
    '<div>' +
    '<div class="order-amount">' + formatPrice(order.totalAmount) + ' сум</div>' +
    '<span class="badge-status ' + badgeClass + '">' + badgeText + '</span>' +
    '</div>' +
    '<div class="order-actions-row">' +
    '<button type="button" class="btn-order-open" onclick="openOrderModalById(\'' + order.id + '\')">Открыть</button>' +
    '<button type="button" class="btn-order-delete" onclick="deleteOrderById(\'' + order.id + '\', event)">Удалить</button>' +
    '</div>' +
    '</div>' +
    '</div>';
}

window.openOrderModalById = function (orderId) {
  const o = allOrders.find(x => x.id === orderId);
  if (o) openOrderModal(o);
};

window.deleteOrderById = async function (orderId, evt) {
  if (evt) evt.stopPropagation();
  if (!confirm('Вы уверены, что хотите удалить этот накладной лист?')) return;

  try {
    if (supabaseClient) {
      await supabaseClient.from('orders').delete().eq('id', orderId);
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/orders?id=eq.' + orderId, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY
        }
      });
    }
    allOrders = allOrders.filter(o => o.id !== orderId);
    saveLocalOrders(allOrders);
    showToast('Заказ успешно удален');
    renderControlOrders();
    renderHistoryOrders();

    const modal = document.getElementById('orderDetailModal');
    if (modal.classList.contains('active') && selectedOrder && selectedOrder.id === orderId) {
      modal.classList.remove('active');
    }
  } catch (err) {
    alert(err.message);
  }
};

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
  if (order.coords && order.coords.lat) {
    yandexNavContainer.style.display = 'block';
    yandexNavLink.href = 'https://yandex.ru/maps/?rtext=~' + order.coords.lat + ',' + order.coords.lng + '&rtt=auto';
    showModalOrderMap(order.coords.lat, order.coords.lng);
  } else {
    yandexNavContainer.style.display = 'none';
    showModalOrderMap(null, null);
  }

  const itemsContainer = document.getElementById('modalItemsList');
  itemsContainer.innerHTML = (order.items || []).map(i =>
    '<div style="display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px dashed #e2e8f0;">' +
    '<div>' +
    '<b>' + i.fullName + '</b>' +
    '<span style="color: var(--text-muted); font-size: 11px;"> (' + (i.volume || '-') + ')</span>' +
    '</div>' +
    '<div style="text-align: right;">' +
    '<div>' + i.quantity + ' шт &times; ' + formatPrice(i.price) + '</div>' +
    '<b style="color: var(--primary-navy);">' + formatPrice(i.quantity * i.price) + ' сум</b>' +
    '</div>' +
    '</div>'
  ).join('');

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
  const agentPhone = sanitizeXml(order.agentPhone || '77 030 32 52');
  const totalAmount = order.totalAmount || 0;
  const totalFormatted = formatPrice(totalAmount);
  const totalInWords = sanitizeXml(numberToWordsRu(totalAmount));

  let rowsXml = '';
  (order.items || []).forEach(item => {
    const name = sanitizeXml(item.fullName || item.name || '');
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
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Агент: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + agentName + ' (' + agentPhone + ')</w:t></w:r></w:p>' +
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
          { text: it.fullName || it.name, fontSize: 8 },
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
                { text: [{ text: 'ТОРГОВЫЙ АГЕНТ: ', bold: true }, (order.agentName || 'Javohir') + ' (' + (order.agentPhone || '77 030 32 52') + ')'] },
                { text: [{ text: 'ДОСТАВЩИК: ', bold: true }, order.agentPhone || '77 030 32 52'] }
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
    (idx + 1) + '. ' + it.fullName + ' — ' + it.quantity + ' шт x ' + formatPrice(it.price) + ' = ' + formatPrice(it.quantity * it.price) + ' сум'
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

  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
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

  document.getElementById('btnDeleteModalOrder').addEventListener('click', () => {
    if (selectedOrder) deleteOrderById(selectedOrder.id);
  });

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
  const btnBatchCostDocxBtn = document.getElementById('btnBatchCostDocx');
  if (btnBatchCostDocxBtn) {
    btnBatchCostDocxBtn.addEventListener('click', downloadBatchCostDocx);
  }
  const btnBatchCostTgBtn = document.getElementById('btnBatchCostTelegram');
  if (btnBatchCostTgBtn) {
    btnBatchCostTgBtn.addEventListener('click', shareBatchCostToTelegram);
  }

  const btnUpdateDesk = document.getElementById('btnCheckUpdatesDesktop');
  if (btnUpdateDesk) {
    btnUpdateDesk.addEventListener('click', requestAppUpdate);
  }
  const btnUpdateMob = document.getElementById('btnCheckUpdatesMobile');
  if (btnUpdateMob) {
    btnUpdateMob.addEventListener('click', requestAppUpdate);
  }
}

function buildSingleCostTableXml(order) {
    const orderNumber = sanitizeXml(order.orderNumber || '000001');
    const deliveryDate = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('/') : '00/00/0000';
    const clientName = sanitizeXml(order.storeName || 'Магазин');
    const ownerText = (order.ownerName || order.ownerPhone)
      ? sanitizeXml('Владелец: ' + (order.ownerName || '-') + (order.ownerPhone ? ' (' + order.ownerPhone + ')' : ''))
      : '';
    const address = sanitizeXml(order.address || 'г. Ташкент');
    const agentName = sanitizeXml(order.agentName || 'Javohir');
    const agentPhone = sanitizeXml(order.agentPhone || '77 030 32 52');

    let totalSelling = 0;
    let totalCost = 0;
    let rowsXml = '';

    (order.items || []).forEach(item => {
      const name = sanitizeXml(item.fullName || item.name || '');
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
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Агент: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>' + agentName + ' (' + agentPhone + ')</w:t></w:r></w:p>' +
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

  async function downloadBatchCostDocx() {
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

    showToast('Генерация сводки себестоимости за ' + d + '...');

    try {
      const blob = await generateCostDocxBlob(matchingOrders);
      const fileName = 'Сводка_Себестоимости_' + d + '.docx';
      if (window.saveAs) {
        window.saveAs(blob, fileName);
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
      }
      showToast('DOCX сводка себестоимости дня скачана!');
    } catch (err) {
      console.error('Batch cost download error:', err);
      alert('Ошибка сводки: ' + err.message);
    }
  }

  async function shareBatchCostToTelegram() {
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
    let grandSelling = 0;
    let grandCost = 0;

    matchingOrders.forEach(o => {
      (o.items || []).forEach(it => {
        const qty = Number(it.quantity) || 1;
        const sellPrice = Number(it.price) || 0;
        let costPrice = Number(it.costPrice);
        if (!costPrice || isNaN(costPrice)) {
          const found = allProducts.find(p => p.id === it.id || p.fullName === it.fullName);
          costPrice = found ? Number(found.costPrice) || 0 : 0;
        }
        grandSelling += (qty * sellPrice);
        grandCost += (qty * costPrice);
      });
    });

    const grandMargin = grandSelling - grandCost;

    let text = 'СВОДНЫЙ ОТЧЁТ ПО СЕБЕСТОИМОСТИ ЗА ' + cisDate + '\n' +
      'Всего накладных: ' + matchingOrders.length + '\n\n' +
      'Общая реализация: ' + formatPrice(grandSelling) + ' сум\n' +
      'Общая себестоимость: ' + formatPrice(grandCost) + ' сум\n' +
      'Чистая маржа (Прибыль): +' + formatPrice(grandMargin) + ' сум\n\n' +
      'ASORTI TRADE PLUS';

    showToast('Подготовка сводки себестоимости дня...');

    try {
      const blob = await generateCostDocxBlob(matchingOrders);
      const fileName = 'Сводка_Себестоимости_' + d + '.docx';
      const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      if (window.OrdersNative && typeof window.OrdersNative.shareFileToTelegram === 'function') {
        const base64Data = await blobToBase64(blob);
        window.OrdersNative.shareFileToTelegram(base64Data, fileName, mimeType, text);
        showToast('Сводка отправлена в Telegram!');
        return;
      }

      if (navigator.share && navigator.canShare) {
        const file = new File([blob], fileName, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Сводка себестоимости за ' + cisDate,
            text: text,
            files: [file]
          });
          showToast('Сводка успешно отправлена!');
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
      showToast('Сводка скачана и открыт Telegram');
    } catch (err) {
      console.error('Batch cost share error:', err);
      alert('Ошибка отправки: ' + err.message);
    }
  }
