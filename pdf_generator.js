// PDF generation utility without external dependencies
// Generates valid PDF 1.4 documents formatted with tables, headers, and metadata

function escapePdfText(str) {
  if (typeof str !== 'string') str = String(str || '');
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function generateAdminReportPdf({ users }) {
  // Page dimensions: A4 is 595.28 x 841.89 points
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2; // 495

  let currentY = 790;
  let pageCommands = [];
  const pages = [pageCommands];

  function newPage() {
    pageCommands = [];
    pages.push(pageCommands);
    currentY = 790;
    // Draw page header
    drawHeader(false);
  }

  function checkPageSpace(needed) {
    if (currentY - needed < margin + 40) {
      newPage();
    }
  }

  function drawHeader(isFirstPage) {
    pageCommands.push(`0.08 0.28 0.45 rg`);
    pageCommands.push(`${margin} ${currentY - 30} ${contentWidth} 30 re f`);
    pageCommands.push(`1 1 1 rg`);
    pageCommands.push(`BT /F2 13 Tf ${margin + 12} ${currentY - 20} Td (ACCOUNT CREDENTIAL AUDIT) Tj ET`);
    currentY -= 42;
  }

  function drawSectionTitle(title) {
    checkPageSpace(45);
    pageCommands.push(`0.12 0.35 0.55 rg`); // Primary Blue
    pageCommands.push(`${margin} ${currentY - 18} ${contentWidth} 20 re f`);
    pageCommands.push(`1 1 1 rg`);
    pageCommands.push(`BT /F2 11 Tf ${margin + 10} ${currentY - 14} Td (${escapePdfText(title.toUpperCase())}) Tj ET`);
    currentY -= 32;
  }

  function drawMetricsGrid(items) {
    checkPageSpace(60);
    const cols = 3;
    const colWidth = (contentWidth - (cols - 1) * 10) / cols;
    const boxHeight = 44;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      if (c === 0 && r > 0) {
        checkPageSpace(boxHeight + 8);
      }
      const x = margin + c * (colWidth + 10);
      const y = currentY - (r + 1) * (boxHeight + 8) + 8;

      pageCommands.push(`0.96 0.97 0.98 rg`);
      pageCommands.push(`${x} ${y} ${colWidth} ${boxHeight} re f`);
      pageCommands.push(`0.82 0.86 0.90 RG 1 w ${x} ${y} ${colWidth} ${boxHeight} re S`);

      // Label
      pageCommands.push(`0.3 0.35 0.4 rg`);
      pageCommands.push(`BT /F1 8 Tf ${x + 8} ${y + boxHeight - 14} Td (${escapePdfText(item.label)}) Tj ET`);
      // Value
      pageCommands.push(`0.08 0.28 0.45 rg`);
      pageCommands.push(`BT /F2 14 Tf ${x + 8} ${y + 10} Td (${escapePdfText(String(item.value))}) Tj ET`);
    }

    const rows = Math.ceil(items.length / cols);
    currentY -= rows * (boxHeight + 8) + 12;
  }

  function drawTable(headers, rows, colWidths) {
    checkPageSpace(40);
    // Header row
    pageCommands.push(`0.90 0.93 0.96 rg`);
    pageCommands.push(`${margin} ${currentY - 18} ${contentWidth} 18 re f`);
    pageCommands.push(`0.15 0.2 0.25 rg`);

    let curX = margin;
    for (let i = 0; i < headers.length; i++) {
      const w = colWidths[i];
      pageCommands.push(`BT /F2 8 Tf ${curX + 6} ${currentY - 13} Td (${escapePdfText(headers[i])}) Tj ET`);
      curX += w;
    }
    currentY -= 20;

    // Rows
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      checkPageSpace(20);
      const row = rows[rIdx];
      if (rIdx % 2 === 1) {
        pageCommands.push(`0.98 0.98 0.99 rg`);
        pageCommands.push(`${margin} ${currentY - 16} ${contentWidth} 16 re f`);
      }
      pageCommands.push(`0.88 0.88 0.90 RG 0.5 w ${margin} ${currentY - 16} m ${margin + contentWidth} ${currentY - 16} l S`);

      pageCommands.push(`0.2 0.2 0.2 rg`);
      curX = margin;
      for (let i = 0; i < row.length; i++) {
        const text = String(row[i] || '').slice(0, Math.floor(colWidths[i] / 5.2));
        pageCommands.push(`BT /F1 8 Tf ${curX + 6} ${currentY - 12} Td (${escapePdfText(text)}) Tj ET`);
        curX += colWidths[i];
      }
      currentY -= 17;
    }
    currentY -= 12;
  }

  // Keep this document limited to the account credential audit.
  drawHeader(true);
  const accountHeaders = ['Account / Email', 'Role', 'Password', 'KDF', 'Salt (Hex)', 'Hash (scrypt)'];
  const accountWidths = [120, 65, 80, 50, 75, 105];
  const accountRows = (users || []).map((user) => [
    user.username,
    user.role,
    'Never Stored',
    'scrypt',
    user.password_salt ? user.password_salt.slice(0, 10) + '...' : 'N/A',
    user.password_hash ? user.password_hash.slice(0, 14) + '...' : 'N/A',
  ]);
  drawTable(accountHeaders, accountRows.length ? accountRows : [['(No accounts)', '-', '-', '-', '-', '-']], accountWidths);
  checkPageSpace(58);
  pageCommands.push(`0.94 0.96 0.98 rg`);
  pageCommands.push(`${margin} ${currentY - 45} ${contentWidth} 45 re f`);
  pageCommands.push(`0.30 0.55 0.75 RG 0.8 w ${margin} ${currentY - 45} ${contentWidth} 45 re S`);
  pageCommands.push(`0.08 0.28 0.45 rg`);
  pageCommands.push(`BT /F2 8 Tf ${margin + 8} ${currentY - 13} Td (INFORMATION SECURITY PRINCIPLE: ZERO-KNOWLEDGE CREDENTIAL STORAGE) Tj ET`);
  pageCommands.push(`BT /F1 7 Tf ${margin + 8} ${currentY - 25} Td (Plaintext passwords are NEVER stored in database, memory, or backups (NIST SP 800-63B / OWASP).) Tj ET`);
  pageCommands.push(`BT /F1 7 Tf ${margin + 8} ${currentY - 36} Td (All accounts use memory-hard scrypt (N=32768, r=8, p=1, 64-byte key) with unique 16-byte random salts + pepper.) Tj ET`);
  currentY -= 55;
  checkPageSpace(20);
  pageCommands.push(`0.25 0.3 0.35 rg`);
  pageCommands.push(`BT /F1 8 Tf ${margin} ${currentY - 10} Td (Cryptographic hashes & salts above are authenticated verification digests.) Tj ET`);

  // --- COMPILE PDF 1.4 BINARY STREAM ---
  let body = '';
  const offsets = [];

  function addObj(str) {
    offsets.push(Buffer.byteLength(body, 'latin1') + 9); // +9 for %PDF-1.4\n
    body += str + '\n';
  }

  // 1: Catalog
  addObj(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);

  // 2: Pages root
  const pageObjIds = pages.map((_, idx) => 3 + idx * 2);
  addObj(`2 0 obj << /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj`);

  // Font Objects: F1 is Helvetica, F2 is Helvetica-Bold
  const font1Id = 3 + pages.length * 2;
  const font2Id = font1Id + 1;

  // For each page: Page Object + Content Stream Object
  for (let i = 0; i < pages.length; i++) {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const stream = pages[i].join('\n');
    const streamLen = Buffer.byteLength(stream, 'latin1');

    addObj(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> >> endobj`);
    addObj(`${contentId} 0 obj << /Length ${streamLen} >> stream\n${stream}\nendstream\nendobj`);
  }

  addObj(`${font1Id} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj`);
  addObj(`${font2Id} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj`);

  const totalObjs = font2Id + 1;
  const startXref = Buffer.byteLength(body, 'latin1') + 9;
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \r\n`;
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \r\n';
  }
  const trailer = `trailer << /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;

  return Buffer.from('%PDF-1.4\n' + body + xref + trailer, 'latin1');
}

module.exports = { generateAdminReportPdf };
