const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');

const TEMPLATE_DOCX_PATH = fs.existsSync(path.join(__dirname, 'template.docx')) 
  ? path.join(__dirname, 'template.docx') 
  : '/home/monarch/Downloads/Telegram Desktop/Work/Orders/Накладной Лист Отправной.docx';

const FONT_REGULAR = fs.existsSync(path.join(__dirname, 'fonts', 'DejaVuSans.ttf'))
  ? path.join(__dirname, 'fonts', 'DejaVuSans.ttf')
  : '/nix/store/37c8di1dc9zp4xfb1pzqdg1gbpbkniw5-dejavu-fonts-2.37/share/fonts/truetype/DejaVuSans.ttf';

const FONT_BOLD = fs.existsSync(path.join(__dirname, 'fonts', 'DejaVuSansCondensed-Bold.ttf'))
  ? path.join(__dirname, 'fonts', 'DejaVuSansCondensed-Bold.ttf')
  : '/nix/store/37c8di1dc9zp4xfb1pzqdg1gbpbkniw5-dejavu-fonts-2.37/share/fonts/truetype/DejaVuSansCondensed-Bold.ttf';

function numberToWordsRu(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Ноль';

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
  if (!str) return 'Ноль';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatPrice(val) {
  return Number(val || 0).toLocaleString('ru-RU').replace(/\s/g, '.');
}

function sanitizeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSingleTableXml(order) {
  const orderNumber = sanitizeXml(order.orderNumber || '000001');
  const deliveryDate = order.deliveryDate ? order.deliveryDate.split('-').reverse().join('/') : '00/00/0000';
  const clientName = sanitizeXml(order.storeName || 'Магазин');
  const address = sanitizeXml(order.address || 'г. Ташкент');
  const agentName = sanitizeXml(order.agentName || 'Javohir');
  const totalAmount = order.totalAmount || 0;
  const totalFormatted = formatPrice(totalAmount);
  const totalInWords = sanitizeXml(numberToWordsRu(totalAmount));

  let rowsXml = '';
  (order.items || []).forEach(item => {
    const name = sanitizeXml(item.fullName || item.name || '');
    const vol = sanitizeXml(item.volume || '-');
    const qty = `${item.quantity} шт`;
    const price = formatPrice(item.price);
    const sum = formatPrice(item.quantity * item.price);

    rowsXml += `
    <w:tr>
      <w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>${name}</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>${vol}</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${qty}</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="18"/></w:rPr><w:t>${price}</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="18"/></w:rPr><w:t>${sum}</w:t></w:r></w:p></w:tc>
    </w:tr>`;
  });

  return `
  <w:tbl>
    <w:tblPr>
      <w:tblW w:w="10200" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="003366"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="003366"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="003366"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="003366"/>
        <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
        <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
      </w:tblBorders>
      <w:jc w:val="center"/>
    </w:tblPr>
    <w:tr>
      <w:tc>
        <w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="24"/></w:rPr><w:t>НАКЛАДНОЙ ЛИСТ № ${orderNumber}</w:t></w:r></w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:tcW w:w="2600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>Дата: ${deliveryDate}</w:t></w:r></w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="2600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>
        <w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr><w:t>ASORTI TRADE PLUS</w:t></w:r></w:p>
      </w:tc>
    </w:tr>
    <w:tr>
      <w:tc>
        <w:tcPr><w:tcW w:w="5000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/></w:tcPr>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ОТПРАВИТЕЛЬ:</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="20"/><w:color w:val="003366"/></w:rPr><w:t>OOO "ASORTI TRADE PLUS"</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Агент: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>${agentName}</w:t></w:r></w:p>
      </w:tc>
      <w:tc>
        <w:tcPr><w:gridSpan w:val="4"/><w:tcW w:w="5200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/></w:tcPr>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>ПОЛУЧАТЕЛЬ (МАГАЗИН):</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="22"/><w:color w:val="111827"/></w:rPr><w:t>${clientName}</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t>Адрес: </w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>${address}</w:t></w:r></w:p>
      </w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>НАИМЕНОВАНИЕ ТОВАРА</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ОБЪЁМ</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>КОЛ-ВО</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ЦЕНА (СУМ)</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>СУММА (СУМ)</w:t></w:r></w:p></w:tc>
    </w:tr>
    ${rowsXml}
    <w:tr>
      <w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6800" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/></w:rPr><w:t>ИТОГО К ОПЛАТЕ: </w:t></w:r><w:r><w:rPr><w:i/><w:sz w:val="18"/></w:rPr><w:t>${totalInWords} сум</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="3400" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="003366"/><w:sz w:val="22"/></w:rPr><w:t>${totalFormatted} сум</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:tcPr><w:gridSpan w:val="3"/><w:tcW w:w="6800" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>Отпустил (экспедитор/склад): ____________________ (Подпись)</w:t></w:r></w:p></w:tc>
      <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:tcW w:w="3400" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>Принял покупатель: _________________ (Подпись)</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  `;
}

async function generateDocx(orders) {
  if (!Array.isArray(orders)) orders = [orders];
  
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_DOCX_PATH));
  
  let combinedTablesXml = '';
  orders.forEach((order, idx) => {
    const copy1 = { ...order, storeName: `${order.storeName} [ЭКЗЕМПЛЯР МАГАЗИНА]` };
    const copy2 = { ...order, storeName: `${order.storeName} [ЭКЗЕМПЛЯР ПОСТАВЩИКА - ASORTI]` };
    
    combinedTablesXml += buildSingleTableXml(copy1);
    combinedTablesXml += `
      <w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="dashed" w:sz="6" w:space="4" w:color="003366"/></w:pBdr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:i/><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t></w:t></w:r></w:p>
    `;
    combinedTablesXml += buildSingleTableXml(copy2);
    
    if (idx < orders.length - 1) {
      combinedTablesXml += `
        <w:p><w:r><w:br w:type="page"/></w:r></w:p>
      `;
    }
  });

  const bodyXml = `
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <w:body>
      ${combinedTablesXml}
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>
      </w:sectPr>
    </w:body>
  </w:document>
  `;

  zip.file('word/document.xml', bodyXml);
  return await zip.generateAsync({ type: 'nodebuffer' });
}

function generatePdf(orders) {
  if (!Array.isArray(orders)) orders = [orders];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 25, size: 'A4' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    if (fs.existsSync(FONT_REGULAR)) {
      doc.registerFont('Cyrillic', FONT_REGULAR);
    }
    if (fs.existsSync(FONT_BOLD)) {
      doc.registerFont('Cyrillic-Bold', FONT_BOLD);
    }

    const regularFont = fs.existsSync(FONT_REGULAR) ? 'Cyrillic' : 'Helvetica';
    const boldFont = fs.existsSync(FONT_BOLD) ? 'Cyrillic-Bold' : 'Helvetica-Bold';

    orders.forEach((order, oIdx) => {
      if (oIdx > 0) doc.addPage();

      const renderCopy = (copyTitle) => {
        const topY = doc.y;
        doc.rect(25, topY, 545, 22).fill('#003366');
        doc.fillColor('#FFFFFF').font(boldFont).fontSize(10);
        doc.text(`НАКЛАДНОЙ ЛИСТ № ${order.orderNumber} ${copyTitle}`, 32, topY + 6);
        doc.text(`Дата: ${order.deliveryDate ? order.deliveryDate.split('-').reverse().join('.') : '-'}`, 390, topY + 6, { align: 'right', width: 170 });

        doc.y = topY + 28;
        doc.fillColor('#1e293b').fontSize(8.5);
        const startY = doc.y;
        
        doc.font(boldFont).text('ОТПРАВИТЕЛЬ: ', 30, startY, { continued: true }).font(regularFont).text('ASORTI TRADE PLUS');
        doc.font(boldFont).text('ТОРГОВЫЙ АГЕНТ: ', 30, doc.y + 2, { continued: true }).font(regularFont).text(order.agentName || 'Javohir');

        doc.font(boldFont).text('ПОЛУЧАТЕЛЬ: ', 290, startY, { continued: true }).font(boldFont).text(order.storeName || 'Магазин');
        const loc = order.address || 'г. Ташкент';
        doc.font(boldFont).text('АДРЕС: ', 290, doc.y + 2, { continued: true }).font(regularFont).text(loc);
        doc.font(boldFont).text('КОНТАКТЫ: ', 290, doc.y + 2, { continued: true }).font(regularFont).text(order.contact || '+998 -- --- -- --');

        doc.y += 10;
        const tableTop = doc.y;
        doc.rect(25, tableTop, 545, 16).fill('#e2e8f0');
        doc.fillColor('#003366').font(boldFont).fontSize(8);
        doc.text('НАИМЕНОВАНИЕ', 30, tableTop + 4);
        doc.text('ОБЪЁМ', 260, tableTop + 4);
        doc.text('КОЛ-ВО', 330, tableTop + 4);
        doc.text('ЦЕНА', 400, tableTop + 4);
        doc.text('СУММА', 480, tableTop + 4, { width: 85, align: 'right' });

        let curY = tableTop + 18;
        doc.font(regularFont).fontSize(8).fillColor('#334155');
        (order.items || []).forEach(item => {
          doc.text((item.fullName || item.name || '').slice(0, 48), 30, curY);
          doc.text(item.volume || '-', 260, curY);
          doc.text(`${item.quantity} ta`, 330, curY);
          doc.text(formatPrice(item.price), 400, curY);
          doc.text(`${formatPrice(item.quantity * item.price)}`, 480, curY, { width: 85, align: 'right' });
          curY += 13;
        });

        doc.rect(25, curY, 545, 1).fill('#cbd5e1');
        curY += 4;
        doc.font(boldFont).fontSize(8.5).fillColor('#003366');
        doc.text(`ИТОГОВАЯ СУММА: ${formatPrice(order.totalAmount)} so’m (${numberToWordsRu(order.totalAmount)} сум)`, 30, curY);

        curY += 14;
        doc.y = curY + 6;
      };

      renderCopy('(ЭКЗЕМПЛЯР МАГАЗИНА)');
      doc.moveDown(0.5);
      doc.strokeColor('#cbd5e1').dash(3, { space: 3 }).moveTo(25, doc.y).lineTo(570, doc.y).stroke().undash();
      doc.moveDown(0.6);
      renderCopy('(ЭКЗЕМПЛЯР ПОСТАВЩИКА)');
    });

    doc.end();
  });
}

module.exports = {
  generateDocx,
  generatePdf,
  numberToWordsRu,
  formatPrice
};
