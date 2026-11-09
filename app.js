// ===== 1. הגדרות =====
const BROWSER_STORAGE_KEY = 'basketball-games';   // השם של המשחקים ב-localStorage
const PLAYER_URL_KEY = 'player-url';              // השם של הלינק לעמוד השחקנית

// כל השדות המספריים. ה-id של כל שדה בטופס זהה לשם השדה באובייקט המשחק,
// וכך אפשר לקרוא ולמלא את כולם בלולאה אחת במקום לכתוב שורה לכל שדה.
const NUMBER_FIELDS = [
  'minutes', 'points', 'rebounds', 'assists', 'steals', 'turnovers',
  'fgMade', 'fgAttempted', 'threeMade', 'threeAttempted', 'ftMade', 'ftAttempted',
];

const form = document.getElementById('game-form');
const formSection = document.getElementById('form-section');
const formTitle = document.getElementById('form-title');
const formHint = document.getElementById('form-hint');
const submitButton = document.getElementById('submit-button');
const cancelButton = document.getElementById('cancel-button');
const errorMessage = document.getElementById('error');
const table = document.getElementById('games-table');
const tableBody = document.getElementById('games-body');
const tableFoot = document.getElementById('games-foot');
const emptyMessage = document.getElementById('empty-message');
const demoButton = document.getElementById('demo-button');
const chartSection = document.getElementById('chart-section');
const chartMessage = document.getElementById('chart-message');
const chartCanvas = document.getElementById('chart');
const playerUrlInput = document.getElementById('player-url');
const importButton = document.getElementById('import-button');
const importStatus = document.getElementById('import-status');
const storageInfo = document.getElementById('storage-info');


// ===== 2. "מצב" (state) של האפליקציה =====
let games = [];                // כל המשחקים השמורים. נטענים פעם אחת בהתחלה
let storageMode = 'browser';   // 'server' = קובץ games.json במחשב, 'browser' = localStorage
let editingId = null;          // המזהה של משחק שעורכים עכשיו, או null
let importQueue = [];          // משחקים מאתר האיגוד שמחכים שתבדקי ותשמרי אותם
let chart = null;              // הגרף שמוצג כרגע


// ===== 3. שמירה וטעינה =====
// האפליקציה עובדת בשני מצבים:
// - כשהשרת פועל (start.bat), המשחקים נשמרים בקובץ games.json במחשב.
// - בלי שרת (GitHub Pages, או לחיצה כפולה על index.html), הם נשמרים בדפדפן.

function loadFromBrowser() {
  try {
    return JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

async function initStorage() {
  try {
    const response = await fetch('api/games');
    if (!response.ok) throw new Error('אין שרת');
    games = await response.json();
    storageMode = 'server';
  } catch {
    // אין שרת: עובדים עם הדפדפן
    games = loadFromBrowser();
    storageMode = 'browser';
    return;
  }

  // מעבר חד-פעמי: אם הקובץ עדיין ריק, אבל בדפדפן שמורים משחקים מהגרסה הקודמת,
  // מעבירים אותם לקובץ. מוחקים מהדפדפן רק אחרי שהשמירה בקובץ הצליחה.
  const oldGames = loadFromBrowser();
  if (games.length === 0 && oldGames.length > 0) {
    games = oldGames;
    if (await persist()) localStorage.removeItem(BROWSER_STORAGE_KEY);
  }
}

async function saveGames() {
  if (storageMode === 'browser') {
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(games));
    return;
  }
  const response = await fetch('api/games', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(games),
  });
  if (!response.ok) throw new Error('השרת לא הצליח לשמור');
}

// שומרת, ואם יש תקלה מציגה הודעה. מחזירה true אם השמירה הצליחה.
async function persist() {
  try {
    await saveGames();
    return true;
  } catch (error) {
    alert('השמירה נכשלה: ' + error.message + '. האם השרת עדיין פועל?');
    return false;
  }
}


// ===== 4. חישובים ועיצוב טקסט =====
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

// למשחקים ישנים חסרים חלק מהשדות (undefined). מציגים מקף במקומם.
function show(value) {
  return value ?? '-';   // ?? = "אם הערך משמאל חסר, קחי את הערך מימין"
}

function percent(made, attempted) {
  if (!attempted) return '-';
  return Math.round((made / attempted) * 100) + '%';
}

// "4/9 (44%)"
function shotsText(made, attempted) {
  if (attempted == null) return '-';
  if (attempted === 0) return '0/0';
  return `${made}/${attempted} (${percent(made, attempted)})`;
}

// "נ 65–58" או "ה 50–57". למשחקים בלי תוצאה מוצג מקף.
function resultText(game) {
  if (game.teamScore == null) return '-';
  const letter = game.result === 'win' ? 'נ' : 'ה';
  return `${letter} ${game.teamScore}–${game.opponentScore}`;
}

// ממוצע של שדה אחד. משחקים שחסר בהם השדה לא נספרים, כדי שלא יורידו את הממוצע.
function average(list, field) {
  const values = list.map(game => game[field]).filter(value => value != null);
  if (values.length === 0) return '-';
  const sum = values.reduce((total, value) => total + value, 0);
  return (sum / values.length).toFixed(1);
}

// אחוז קליעה עונתי = סך הקליעות חלקי סך הניסיונות (לא ממוצע של אחוזים!)
function seasonPercent(list, madeField, attemptedField) {
  let made = 0;
  let attempted = 0;
  for (const game of list) {
    if (game[attemptedField] == null) continue;
    made += game[madeField];
    attempted += game[attemptedField];
  }
  return percent(made, attempted);
}


// ===== 5. הצגה =====
function renderAll() {
  // [...games] = עותק, כדי שהמיון לא ישנה את הרשימה המקורית
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));

  const hasGames = sorted.length > 0;
  table.hidden = !hasGames;
  emptyMessage.hidden = hasGames;
  chartSection.hidden = !hasGames;

  renderTable([...sorted].reverse());   // בטבלה: מהחדש לישן
  renderAverages(sorted);
  renderChart(sorted);                  // בגרף: מהישן לחדש
}

function addCell(row, text) {
  const cell = document.createElement('td');
  cell.textContent = text;   // textContent ולא innerHTML: טקסט נשאר טקסט, קוד לא ירוץ
  row.appendChild(cell);
  return cell;
}

function addButton(cell, text, className, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  cell.appendChild(button);
}

function renderTable(list) {
  tableBody.innerHTML = '';

  for (const game of list) {
    const row = document.createElement('tr');

    addCell(row, formatDate(game.date));
    addCell(row, game.opponent);
    const result = addCell(row, resultText(game));
    if (game.result) result.className = game.result;   // "win" או "loss": ירוק או אדום מה-CSS
    addCell(row, game.minutes);
    addCell(row, game.points);
    addCell(row, game.rebounds);
    addCell(row, game.assists);
    addCell(row, show(game.steals));
    addCell(row, show(game.turnovers));
    addCell(row, shotsText(game.fgMade, game.fgAttempted));
    addCell(row, shotsText(game.threeMade, game.threeAttempted));
    addCell(row, shotsText(game.ftMade, game.ftAttempted));

    const actions = addCell(row, '');
    addButton(actions, 'עריכה', 'row-btn', () => startEdit(game));
    addButton(actions, 'מחיקה', 'row-btn delete', () => deleteGame(game.id));

    tableBody.appendChild(row);
  }
}

function renderAverages(list) {
  tableFoot.innerHTML = '';
  if (list.length === 0) return;

  const row = document.createElement('tr');
  const label = addCell(row, `ממוצע (${list.length} משחקים)`);
  label.colSpan = 3;   // התא תופס שלוש עמודות: תאריך, יריבה, תוצאה

  for (const field of ['minutes', 'points', 'rebounds', 'assists', 'steals', 'turnovers']) {
    addCell(row, average(list, field));
  }
  addCell(row, seasonPercent(list, 'fgMade', 'fgAttempted'));
  addCell(row, seasonPercent(list, 'threeMade', 'threeAttempted'));
  addCell(row, seasonPercent(list, 'ftMade', 'ftAttempted'));
  addCell(row, '');

  tableFoot.appendChild(row);
}

function renderChart(list) {
  // Chart.js נטען מהאינטרנט. בלי חיבור הוא לא קיים, ובמקום קריסה נציג הודעה.
  if (typeof Chart === 'undefined') {
    chartMessage.textContent = 'הגרף לא נטען. צריך חיבור לאינטרנט.';
    chartMessage.hidden = false;
    return;
  }

  if (chart) chart.destroy();   // מוחקים את הגרף הקודם לפני שמציירים חדש

  chart = new Chart(chartCanvas, {
    type: 'line',
    data: {
      labels: list.map(game => formatDate(game.date)),
      datasets: [
        { label: 'נקודות',    data: list.map(g => g.points),   borderColor: '#d35400', backgroundColor: '#d35400' },
        { label: 'ריבאונדים', data: list.map(g => g.rebounds), borderColor: '#2471a3', backgroundColor: '#2471a3' },
        { label: 'אסיסטים',   data: list.map(g => g.assists),  borderColor: '#229954', backgroundColor: '#229954' },
      ],
    },
    options: {
      maintainAspectRatio: false,
      elements: { line: { tension: 0.3 } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
      plugins: {
        legend: { rtl: true },
        tooltip: {
          rtl: true,
          callbacks: {
            title: (items) => {
              const game = list[items[0].dataIndex];
              return `${formatDate(game.date)} נגד ${game.opponent}`;
            },
          },
        },
      },
    },
  });
}

function renderStorageInfo() {
  storageInfo.textContent = storageMode === 'server'
    ? 'המשחקים נשמרים בקובץ games.json במחשב שלך.'
    : 'המשחקים נשמרים בדפדפן הזה בלבד.';
}


// ===== 6. הטופס: קריאה, מילוי ובדיקה =====
function readForm() {
  const fields = {
    date: document.getElementById('date').value,
    opponent: document.getElementById('opponent').value.trim(),
  };
  for (const field of NUMBER_FIELDS) {
    fields[field] = Number(document.getElementById(field).value);
  }
  return fields;
}

function fillForm(game) {
  document.getElementById('date').value = game.date;
  document.getElementById('opponent').value = game.opponent;
  for (const field of NUMBER_FIELDS) {
    document.getElementById(field).value = game[field] ?? '';
  }
}

// מחזירה הודעת שגיאה, או null אם הכול תקין
function validate(game) {
  if (game.fgMade > game.fgAttempted)
    return 'קליעות מהשדה לא יכולות להיות יותר מהניסיונות מהשדה.';
  if (game.threeMade > game.threeAttempted)
    return 'קליעות לשלוש לא יכולות להיות יותר מהניסיונות לשלוש.';
  if (game.ftMade > game.ftAttempted)
    return 'קליעות עונשין לא יכולות להיות יותר מהניסיונות מהעונשין.';
  if (game.threeAttempted > game.fgAttempted)
    return 'ניסיונות לשלוש הם חלק מהניסיונות מהשדה, ולכן לא יכולים להיות יותר מהם.';
  if (game.threeMade > game.fgMade)
    return 'קליעות לשלוש הן חלק מהקליעות מהשדה, ולכן לא יכולות להיות יותר מהן.';
  return null;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
}


// ===== 7. מצבי הטופס: הוספה / עריכה / משחק מהאתר =====

// מחזירה את הטופס למצב הרגיל: "הוספת משחק"
function resetForm() {
  editingId = null;
  form.reset();
  showError(null);
  formHint.hidden = true;
  formTitle.textContent = 'הוספת משחק';
  cancelButton.hidden = true;
  formSection.classList.remove('editing');
}

function startEdit(game) {
  if (importQueue.length > 0) {
    importQueue = [];
    setImportStatus('הייבוא הופסק. כדי להמשיך, לחצי שוב על "עדכון מהאתר".');
  }
  resetForm();
  editingId = game.id;
  fillForm(game);
  formTitle.textContent = `עריכת משחק נגד ${game.opponent}`;
  cancelButton.textContent = 'ביטול עריכה';
  cancelButton.hidden = false;
  formSection.classList.add('editing');
  formSection.scrollIntoView({ behavior: 'smooth' });
}

// ממלאת את הטופס במשחק הבא שמחכה מאתר האיגוד
function showNextImported() {
  resetForm();
  if (importQueue.length === 0) return;

  const game = importQueue[0];
  fillForm(game);
  formTitle.textContent = `משחק מהאתר: נגד ${game.opponent} (${resultText(game)})`;
  cancelButton.textContent = 'דילוג על המשחק';
  cancelButton.hidden = false;
  formSection.classList.add('editing');

  let hint = 'הנתונים מולאו מאתר האיגוד. בדקי אותם ולחצי "שמירת משחק".';
  const waiting = importQueue.length - 1;
  if (waiting > 0) hint += ` אחריו מחכים עוד ${waiting} משחקים.`;
  const sameDate = games.find(old => old.date === game.date);
  if (sameDate) hint += ` שימי לב: כבר שמור משחק בתאריך הזה (נגד ${sameDate.opponent}).`;
  formHint.textContent = hint;
  formHint.hidden = false;

  formSection.scrollIntoView({ behavior: 'smooth' });
}

// אחרי שמירה או דילוג על משחק מהאתר: עוברים לבא בתור
function nextImported() {
  importQueue.shift();   // shift = מוציא את הראשון מהרשימה
  if (importQueue.length === 0) {
    setImportStatus('סיימת לעבור על כל המשחקים החדשים ✓', 'success');
  }
  showNextImported();
}


// ===== 8. שמירה ומחיקה =====
form.addEventListener('submit', async (event) => {
  event.preventDefault();   // בלי זה הדפדפן היה מרענן את הדף

  const fields = readForm();
  const error = validate(fields);
  showError(error);
  if (error) return;

  const importing = editingId === null && importQueue.length > 0;

  if (editingId !== null) {
    // עריכה: { ...old, ...fields } = כל השדות של הישן, ומעליהם השדות מהטופס.
    // כך שדות שאין בטופס (תוצאה, קישור לאתר) לא הולכים לאיבוד.
    games = games.map(old => old.id === editingId ? { ...old, ...fields } : old);
  } else if (importing) {
    // משחק מהאתר: שומרים גם את התוצאה ואת המספר שלו באתר (sourceId),
    // וגם את מה שתיקנת בטופס
    games.push({ ...importQueue[0], ...fields, id: Date.now() });
  } else {
    games.push({ ...fields, id: Date.now() });
  }

  await persist();
  renderAll();

  if (importing) {
    nextImported();
  } else {
    resetForm();
  }
});

cancelButton.addEventListener('click', () => {
  if (editingId === null && importQueue.length > 0) {
    nextImported();   // דילוג על משחק מהאתר
  } else {
    resetForm();      // ביטול עריכה
  }
});

async function deleteGame(id) {
  if (!confirm('למחוק את המשחק?')) return;
  games = games.filter(game => game.id !== id);
  if (editingId === id) resetForm();
  await persist();
  renderAll();
}


// ===== 9. ייבוא מאתר האיגוד =====
function setImportStatus(message, className = 'muted') {
  importStatus.textContent = message;
  importStatus.className = className;
}

// async = פונקציה שיודעת "לחכות" (await) לדברים שלוקחים זמן, כמו תשובה מהשרת,
// בלי לתקוע את הדף בינתיים
async function importFromSite() {
  const url = playerUrlInput.value.trim();
  if (!url) {
    setImportStatus('הדביקי קודם את הלינק לעמוד השחקנית שלך.', 'error');
    return;
  }
  localStorage.setItem(PLAYER_URL_KEY, url);

  // שולחים לשרת את המשחקים שכבר שמורים, כדי שלא יוריד אותם שוב
  const known = games.filter(game => game.sourceId).map(game => game.sourceId);

  importButton.disabled = true;
  setImportStatus('מייבא... האתר מבקש 10 שניות בין עמוד לעמוד, אז כשיש הרבה משחקים חדשים זה יכול לקחת כמה דקות.');

  try {
    const params = new URLSearchParams({ url, known: known.join(',') });
    const response = await fetch('api/import?' + params);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    // מהמשחק הישן לחדש
    importQueue = data.games.sort((a, b) => a.date.localeCompare(b.date));

    const messages = [];
    if (importQueue.length === 0) {
      messages.push('אין משחקים חדשים באתר. הכול מעודכן ✓');
    } else {
      messages.push(`נמצאו ${importQueue.length} משחקים חדשים. הראשון כבר מחכה בטופס.`);
    }
    messages.push(...data.warnings);
    setImportStatus(messages.join(' '), data.warnings.length ? 'error' : 'success');

    showNextImported();
  } catch (error) {
    // TypeError כאן אומר שלא הייתה תשובה בכלל, כנראה כי השרת לא פועל
    const hint = error instanceof TypeError ? ' האם השרת עדיין פועל?' : '';
    setImportStatus('הייבוא נכשל: ' + error.message + hint, 'error');
  } finally {
    importButton.disabled = false;   // finally רץ תמיד: גם אחרי הצלחה וגם אחרי שגיאה
  }
}

function setupImport() {
  if (storageMode === 'browser') {
    importButton.disabled = true;
    playerUrlInput.disabled = true;
    setImportStatus(location.protocol === 'file:'
      ? 'כדי לייבא מהאתר, צריך לפתוח את האפליקציה דרך השרת: לחיצה כפולה על start.bat.'
      : 'ייבוא מאתר האיגוד זמין רק כשהאפליקציה רצה במחשב עם השרת. כאן אפשר להזין משחקים ידנית.');
    return;
  }
  playerUrlInput.value = localStorage.getItem(PLAYER_URL_KEY) || '';
  importButton.addEventListener('click', importFromSite);
}


// ===== 10. נתוני דוגמה (לגרסה המקוונת) =====
async function loadDemo() {
  try {
    const response = await fetch('demo-data.json');
    games = await response.json();
  } catch {
    alert('לא הצלחתי לטעון את נתוני הדוגמה.');
    return;
  }
  await persist();
  renderAll();
}

function setupDemo() {
  // רק בדפדפן, ולא כשיש שרת: לא רוצים לערבב נתוני דוגמה עם הנתונים האמיתיים בקובץ
  demoButton.hidden = storageMode !== 'browser' || location.protocol === 'file:';
  demoButton.addEventListener('click', loadDemo);
}


// ===== 11. התחלה =====
async function start() {
  await initStorage();   // קודם טוענים את המשחקים (מהשרת או מהדפדפן)
  setupImport();
  setupDemo();
  renderStorageInfo();
  renderAll();
}

start();
