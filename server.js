const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { generateDocx, generatePdf } = require('./docGenerator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data', 'orders.json');
const PRODUCTS_FILE = path.join(__dirname, 'products.json');

if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function getOrders() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(orders, null, 2));
}

function getProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function broadcastUpdate(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'INIT', data: getOrders() }));
});

app.get('/api/products', (req, res) => {
  res.json(getProducts());
});

app.get('/api/geocode', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Координаты обязательны' });
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=ru`;
    const response = await fetch(url, { headers: { 'User-Agent': 'OrdersApp/5.0' } });
    const data = await response.json();
    
    let formatted = data.display_name;
    if (data.address) {
      const a = data.address;
      const parts = [];
      if (a.road) parts.push(a.road);
      if (a.suburb || a.city_district) parts.push(a.suburb || a.city_district);
      if (a.city || a.town || a.county) parts.push(a.city || a.town || a.county);
      if (parts.length > 0) formatted = parts.join(', ');
    }
    res.json({ address: formatted || data.display_name });
  } catch (err) {
    console.error('Geocode error:', err);
    res.json({ address: 'г. Ташкент' });
  }
});

app.get('/api/orders', (req, res) => {
  const orders = getOrders();
  const { status, date } = req.query;
  let filtered = orders;
  if (status) {
    filtered = filtered.filter(o => o.status === status);
  }
  if (date) {
    filtered = filtered.filter(o => o.deliveryDate === date);
  }
  res.json(filtered);
});

app.get('/api/orders/:id', (req, res) => {
  const orders = getOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(order);
});

app.post('/api/orders', (req, res) => {
  const { storeName, deliveryDate, coords, address, items, agentName, agentPhone } = req.body;
  
  if (!storeName || !deliveryDate || !items || !items.length) {
    return res.status(400).json({ error: 'Пожалуйста, заполните магазин, дату и добавьте товары' });
  }

  const orders = getOrders();
  const rnd = Math.floor(100000 + Math.random() * 900000);
  const orderNumber = String(rnd);

  const totalAmount = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
  const cleanAddress = address && !address.startsWith('Координаты:') ? address : 'г. Ташкент';

  const newOrder = {
    id: `ord-${orderNumber}`,
    orderNumber,
    deliveryDate,
    storeName: storeName.trim(),
    address: cleanAddress,
    coords: coords || null,
    agentName: agentName || 'Javohir',
    agentPhone: agentPhone || '77 030 32 52',
    status: 'planned',
    createdAt: new Date().toISOString(),
    items: items.map(i => ({
      id: i.id,
      fullName: i.fullName || i.name,
      volume: i.volume || '-',
      price: Number(i.price) || 0,
      quantity: Number(i.quantity) || 1
    })),
    totalAmount
  };

  orders.unshift(newOrder);
  saveOrders(orders);
  
  broadcastUpdate('ORDER_CREATED', newOrder);

  res.status(201).json(newOrder);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['planned', 'delivered', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }

  const orders = getOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveOrders(orders);

  broadcastUpdate('ORDER_STATUS_CHANGED', order);

  res.json(order);
});

app.delete('/api/orders/:id', (req, res) => {
  let orders = getOrders();
  const initialLen = orders.length;
  orders = orders.filter(o => o.id !== req.params.id);
  if (orders.length === initialLen) {
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  saveOrders(orders);

  broadcastUpdate('ORDER_DELETED', { id: req.params.id });

  res.json({ success: true, message: 'Заказ удален' });
});

app.get('/api/orders/:id/download/docx', async (req, res) => {
  try {
    const orders = getOrders();
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const docxBuf = await generateDocx(order);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="nakladnaya_${order.orderNumber}.docx"; filename*=UTF-8''${encodeURIComponent(`Накладная_№${order.orderNumber}.docx`)}`);
    res.send(docxBuf);
  } catch (err) {
    console.error('Error generating DOCX:', err);
    res.status(500).json({ error: 'Ошибка генерации DOCX' });
  }
});

app.get('/api/orders/:id/download/pdf', async (req, res) => {
  try {
    const orders = getOrders();
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });

    const pdfBuf = await generatePdf(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nakladnaya_${order.orderNumber}.pdf"; filename*=UTF-8''${encodeURIComponent(`Накладная_№${order.orderNumber}.pdf`)}`);
    res.send(pdfBuf);
  } catch (err) {
    console.error('Error generating PDF:', err);
    res.status(500).json({ error: 'Ошибка генерации PDF' });
  }
});

app.get('/api/download-date/:date/:format', async (req, res) => {
  try {
    const { date, format } = req.params;
    const orders = getOrders().filter(o => o.deliveryDate === date);
    if (!orders.length) return res.status(404).json({ error: 'На эту дату заказов нет' });

    if (format === 'docx') {
      const docxBuf = await generateDocx(orders);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="orders_${date}.docx"; filename*=UTF-8''${encodeURIComponent(`Сборник_Заказов_${date}.docx`)}`);
      return res.send(docxBuf);
    } else if (format === 'pdf') {
      const pdfBuf = await generatePdf(orders);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="orders_${date}.pdf"; filename*=UTF-8''${encodeURIComponent(`Сборник_Заказов_${date}.pdf`)}`);
      return res.send(pdfBuf);
    } else {
      res.status(400).json({ error: 'Неподдерживаемый формат' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сборного экспорта' });
  }
});

server.listen(PORT, () => {
  console.log(`Orders backend running with WebSockets on http://localhost:${PORT}`);
});
