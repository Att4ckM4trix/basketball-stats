"""
שרת קטן לאפליקציית הסטטיסטיקות.

יש לו שלושה תפקידים:
1. להגיש את קבצי האפליקציה (index.html, style.css, app.js) לדפדפן.
2. לשמור ולטעון את המשחקים מהקובץ games.json (בכתובת /api/games).
3. לקבל בקשה בכתובת /api/import, לקרוא את עמוד השחקנית באתר האיגוד,
   ולהחזיר לדפדפן את המשחקים כנתונים מסודרים (JSON).

הפעלה: python server.py   (או לחיצה כפולה על start.bat)
עצירה:  Ctrl+C
"""

import html
import json
import re
import time
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

PORT = 8000
FOLDER = Path(__file__).parent          # התיקייה שבה נמצא הקובץ הזה
SITE = 'ibasketball.co.il'
DELAY_SECONDS = 10                      # האתר מבקש (ב-robots.txt) לחכות 10 שניות בין בקשות
USER_AGENT = 'Mozilla/5.0 (personal basketball stats tracker)'
DATA_FILE = FOLDER / 'games.json'       # כאן נשמרים המשחקים
MAX_DATA_SIZE = 5_000_000               # 5MB. הגנה מפני בקשה ענקית בטעות


# ===== 0. שמירה וטעינה של המשחקים בקובץ =====

def read_games():
    if not DATA_FILE.exists():
        return []
    return json.loads(DATA_FILE.read_text(encoding='utf-8'))


def write_games(games):
    # כותבים קודם לקובץ זמני, ורק אחר כך מחליפים את הקובץ האמיתי.
    # אם המחשב נכבה באמצע הכתיבה, הקובץ המקורי נשאר שלם.
    temp_file = DATA_FILE.with_suffix('.tmp')
    temp_file.write_text(json.dumps(games, ensure_ascii=False, indent=2), encoding='utf-8')
    temp_file.replace(DATA_FILE)


# ===== 1. הורדת עמודים מהאתר =====

last_request_time = 0.0

def fetch_page(url):
    """מוריד עמוד ומחזיר אותו כטקסט. דואג לחכות 10 שניות מאז הבקשה הקודמת."""
    global last_request_time
    wait = DELAY_SECONDS - (time.time() - last_request_time)
    if wait > 0:
        print(f'  waiting {wait:.0f}s (site asks for 10s between requests)')
        time.sleep(wait)

    print(f'  downloading {url}')
    request = Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urlopen(request, timeout=30) as response:
            return response.read().decode('utf-8')
    finally:
        last_request_time = time.time()


# ===== 2. פונקציות עזר לקריאת טקסט =====

def text_of(fragment):
    """מוריד תגיות HTML ומשאיר רק את הטקסט. למשל '<b>שלום</b>' הופך ל-'שלום'."""
    return html.unescape(re.sub(r'<[^>]+>', '', fragment)).strip()


def to_int(text):
    """'22' -> 22,  '21.9' -> 22,  '' -> 0"""
    try:
        return round(float(text_of(text)))
    except ValueError:
        return 0


def made_attempted(text):
    """'3.0-5.0' -> (3, 5): קליעות וניסיונות."""
    match = re.match(r'([\d.]+)-([\d.]+)', text_of(text))
    if not match:
        return 0, 0
    return round(float(match.group(1))), round(float(match.group(2)))


# ===== 3. קריאת עמוד השחקנית =====

def parse_player_page(page):
    """מחזיר רשימה של משחקים מהטבלאות 'פירוט לפי משחקים' (בלי תאריך ותוצאה)."""
    games = []

    # יכולה להיות יותר מטבלה אחת (למשל עונה רגילה ופלייאוף), אז עוברים על כולן.
    # re.S אומר ש-'.' תופס גם ירידות שורה.
    tables = re.findall(r'פירוט לפי משחקים.*?<tbody>(.*?)</tbody>', page, re.S)

    for table in tables:
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S):
            # כל תא נראה כך: <td class="data-pts">10</td>
            # אוספים מילון: {'pts': '10', 'reb': '10', ...}
            cells = dict(re.findall(r'<td class="data-([a-z]+)">(.*?)</td>', row, re.S))

            name_cell = cells.get('name', '')
            link = re.search(r'/match/(\d+)/"\s+class="([^"]*)"', name_cell)
            if not link:
                continue
            match_id, link_classes = link.groups()

            # שם היריבה הוא הטקסט שלפני הסימון "(ב)" / "(ח)"
            opponent = re.search(r'<a[^>]*>(.*?)<span', name_cell, re.S)

            # באתר, "2 נק" ו-"3 נק" נפרדים. אצלנו "מהשדה" כולל את שניהם.
            two_made, two_attempted = made_attempted(cells.get('fgs', ''))
            three_made, three_attempted = made_attempted(cells.get('threeps', ''))
            ft_made, ft_attempted = made_attempted(cells.get('fts', ''))

            games.append({
                'sourceId': match_id,
                'opponent': text_of(opponent.group(1)) if opponent else text_of(name_cell),
                'home': 'event-home' in link_classes,
                'minutes': to_int(cells.get('min', '')),
                'points': to_int(cells.get('pts', '')),
                'rebounds': to_int(cells.get('reb', '')),
                'assists': to_int(cells.get('ast', '')),
                'steals': to_int(cells.get('stl', '')),
                'turnovers': to_int(cells.get('to', '')),
                'fgMade': two_made + three_made,
                'fgAttempted': two_attempted + three_attempted,
                'threeMade': three_made,
                'threeAttempted': three_attempted,
                'ftMade': ft_made,
                'ftAttempted': ft_attempted,
            })

    return games


# ===== 4. קריאת עמוד משחק (בשביל התאריך והתוצאה) =====

def parse_match_page(page):
    """מחזיר (תאריך בפורמט 2026-10-20, נקודות בית, נקודות חוץ), או None אם לא נמצא."""
    date = re.search(r'<div class="date"[^>]*>(\d{2})-(\d{2})-(\d{4})</div>', page)
    home_score = re.search(r'data-event-home-score>(\d+)<', page)
    away_score = re.search(r'data-event-away-score>(\d+)<', page)
    if not (date and home_score and away_score):
        return None
    day, month, year = date.groups()
    return f'{year}-{month}-{day}', int(home_score.group(1)), int(away_score.group(1))


# ===== 5. הייבוא עצמו =====

def clean_player_url(url):
    """
    בודק שהלינק הוא באמת לעמוד שחקנית באתר האיגוד, ומחזיר גרסה נקייה שלו.
    בלי הבדיקה הזו, כל אחד היה יכול לבקש מהשרת שלנו להוריד כל אתר שהוא.
    """
    address = urlparse(url.strip())
    if address.hostname not in (SITE, 'www.' + SITE) or not address.path.startswith('/player/'):
        return None
    return f'https://{SITE}{address.path}'


def import_games(player_url, known_ids):
    """מחזיר מילון עם המשחקים החדשים ורשימת אזהרות."""
    rows = parse_player_page(fetch_page(player_url))
    if not rows:
        return {'games': [], 'warnings': ['לא נמצאה טבלת משחקים בעמוד. אולי מבנה האתר השתנה?']}

    new_rows = [row for row in rows if row['sourceId'] not in known_ids]
    print(f'  found {len(rows)} games on the site, {len(new_rows)} new')

    games, warnings = [], []
    for game in new_rows:
        try:
            match = parse_match_page(fetch_page(f'https://{SITE}/match/{game["sourceId"]}/'))
        except Exception as error:
            warnings.append(f'לא הצלחתי להוריד את המשחק נגד {game["opponent"]}: {error}')
            continue
        if match is None:
            warnings.append(f'לא מצאתי תאריך ותוצאה למשחק נגד {game["opponent"]}.')
            continue

        game['date'], home_score, away_score = match
        game['teamScore'] = home_score if game['home'] else away_score
        game['opponentScore'] = away_score if game['home'] else home_score
        game['result'] = 'win' if game['teamScore'] > game['opponentScore'] else 'loss'
        games.append(game)

    return {'games': games, 'warnings': warnings}


# ===== 6. השרת =====

class Handler(SimpleHTTPRequestHandler):
    """
    SimpleHTTPRequestHandler כבר יודע להגיש קבצים מתיקייה.
    אנחנו רק מוסיפים לו כתובת אחת מיוחדת: /api/import
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FOLDER), **kwargs)

    # GET = "תני לי משהו"
    def do_GET(self):
        address = urlparse(self.path)
        if address.path == '/api/games':
            self.send_json(200, read_games())
        elif address.path == '/api/import':
            self.handle_import(parse_qs(address.query))
        else:
            super().do_GET()   # כל בקשה אחרת: מגישים קובץ רגיל

    # PUT = "שמרי את זה במקום מה שיש"
    def do_PUT(self):
        if urlparse(self.path).path != '/api/games':
            self.send_json(404, {'error': 'כתובת לא מוכרת'})
            return

        length = int(self.headers.get('Content-Length', 0))
        if length > MAX_DATA_SIZE:
            self.send_json(413, {'error': 'הנתונים גדולים מדי'})
            return

        try:
            games = json.loads(self.rfile.read(length).decode('utf-8'))
        except ValueError:
            self.send_json(400, {'error': 'הנתונים לא בפורמט JSON תקין'})
            return
        if not isinstance(games, list):
            self.send_json(400, {'error': 'מצפה לרשימה של משחקים'})
            return

        write_games(games)
        print(f'Saved {len(games)} games to {DATA_FILE.name}')
        self.send_json(200, {'saved': len(games)})

    def handle_import(self, params):
        player_url = clean_player_url(params.get('url', [''])[0])
        if not player_url:
            self.send_json(400, {'error': 'הלינק צריך להיות לעמוד שחקנית באתר האיגוד (ibasketball.co.il/player/...).'})
            return

        known_ids = set(params.get('known', [''])[0].split(','))
        print(f'Import requested: {player_url}')
        try:
            result = import_games(player_url, known_ids)
        except Exception as error:
            self.send_json(502, {'error': f'לא הצלחתי לקרוא את עמוד השחקנית: {error}'})
            return
        self.send_json(200, result)

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    # 127.0.0.1 = "המחשב הזה בלבד". מחשבים אחרים ברשת לא יוכלו להתחבר.
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://localhost:{PORT}'
    print(f'Server running at {url}  (press Ctrl+C to stop)')
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('Server stopped.')
