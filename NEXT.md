# מה עושים עכשיו

רשימה לפי הסדר. כל שלב מניח שהקודם נגמר, חוץ מהשלבים שכתוב עליהם שהם במקביל.

---

## שלב 0 · לפרוס את אפליקציית הווב

**חייב לקרות ראשון.** האפליקציות בטלפון מדברות עם השרת שלך, ונקודות הקצה שהן צריכות עדיין לא פרוסות.

```
npm install
npm run deploy
```

בדיקה: פתח את האפליקציה בדפדפן, לך להגדרות. אתה אמור לראות תפריט קצר של שש שורות ולא מסך אחד ארוך. אם אתה רואה את הישן, הפריסה לא עברה.

- [ ] נפרס
- [ ] ההגדרות נראות חדשות

---

## שלב 1 · סודות ב־Cloudflare

שלושה מהם נחוצים להתראות. `VAPID_PRIVATE` חסר מזמן וזה מה שמפעיל התראות בדפדפן, אז הוא ראשון.

קודם תבדוק אם הוא כבר שם:

```
npx wrangler secret list
```

אם `VAPID_PRIVATE` מופיע ברשימה, אתה מסודר, דלג הלאה.

אם לא, המפתח הפרטי לא קיים בשום מקום בפרויקט ואי אפשר לחלץ אותו מהמפתח הציבורי. מייצרים זוג חדש:

```
npx web-push generate-vapid-keys
```

את ה־Public מדביקים ב־`wrangler.toml` בשורת `VAPID_PUBLIC`, במקום מה שיש שם.
את ה־Private מכניסים כסוד, והוא לא נשמר בשום קובץ:

```
npx wrangler secret put VAPID_PRIVATE
npm run deploy
```

זוג חדש מבטל את כל המנויים הקיימים להתראות. האפליקציה כבר יודעת לזהות שהמפתח התחלף ולהירשם מחדש לבד בפתיחה הבאה, אז אף אחד לא צריך לעשות כלום, אבל ביום הראשון ייתכן שמישהו יפספס התראה עד שיפתח את האפליקציה.

- [ ] `VAPID_PRIVATE` קיים או נוצר מחדש

את שני אלה תעשה כשתגיע לשלבים של הטלפונים, לא עכשיו:

- [ ] `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` (שלב 4)
- [ ] `FCM_SERVICE_ACCOUNT` (שלב 3)

---

## שלב 2 · לדחוף לגיטהאב ולראות אם זה מתקמפל

הריפו כבר מוכן בתיקייה, עם commit ראשון ועם `.gitignore` שמונע מפתחות מלהיכנס בטעות.

צור ריפו **פרטי** בגיטהאב, ואז:

```
git remote add origin git@github.com:USER/shavtzak.git
git push -u origin main
```

הדחיפה מפעילה לבד את **Compile check**. הוא לא מבקש שום סוד ולא מעלה לשום מקום. הוא רק בודק שהקוד מתקמפל, ומחזיר גם APK של debug להתקנה ישירה.

זה השלב שכנראה ייכשל. שלח לי את הלוג.

- [ ] נדחף
- [ ] Compile check ירוק בשלושת החלקים

---

## שלב 3 · אנדרואיד

מתחילים מכאן כי זה מהיר. שתי דקות בנייה במקום עשר.

### 3א · הכתובת

בגיטהאב: Settings ← Secrets and variables ← Actions ← לשונית **Variables** ← New variable
בשם `SH_ORIGIN`, והערך הוא הכתובת של האפליקציה. בלי לוכסן בסוף.

- [ ] `SH_ORIGIN`

### 3ב · מפתח חתימה

אם יש לך כבר keystore מהאפליקציה הקודמת אפשר להשתמש בו. אחרת:

```
keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias upload
base64 -i upload.jks | tr -d '\n'
```

**שמור את הקובץ במקום בטוח.** בלעדיו אי אפשר לעדכן את האפליקציה בחנות לעולם.

### 3ג · Firebase

פרויקט חדש ב־console.firebase.google.com ← הוסף אפליקציית אנדרואיד עם שם החבילה `com.shavtzak.app` ← הורד `google-services.json`.

באותו מקום: Project settings ← Service accounts ← Generate new private key. הקובץ הזה הולך ל־Cloudflare:

```
npx wrangler secret put FCM_SERVICE_ACCOUNT
```

- [ ] `google-services.json` בהישג יד
- [ ] `FCM_SERVICE_ACCOUNT` ב־Cloudflare

### 3ד · סודות בגיטהאב

| שם | ערך |
|---|---|
| `ANDROID_KEYSTORE_B64` | ה־keystore ב־base64 |
| `ANDROID_KEYSTORE_PASSWORD` | הסיסמה |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | סיסמת המפתח |
| `GOOGLE_SERVICES_JSON` | תוכן הקובץ |

### 3ה · לבנות ולבדוק

Actions ← Android ← Run workflow. בסוף יש `.apk` ו־`.aab` להורדה.

התקן את ה־APK על הטלפון שלך ובדוק:

- [ ] נפתח ומראה את השבצ״ק
- [ ] אחרי התחברות, לחיצה ארוכה על מסך הבית ← ווידג׳טים ← שבצ״ק. הוא מראה את הדבר הבא שלך
- [ ] שלח לעצמך הודעה מהניהול, ותראה שהיא מגיעה כהתראה

### 3ו · לחנות

צור אפליקציה חדשה בקונסולה עם שם החבילה `com.shavtzak.app`, והעלה את ה־`.aab` **ידנית** בפעם הראשונה. אחרי זה אפשר להדליק את `publish` בטופס וההעלאות הבאות יקרו לבד.

- [ ] הועלה
- [ ] יצא לבדיקה פנימית או לייצור

---

## שלב 4 · אייפון

### 4א · הכתובת

ב־`ios/project.yml`, שנה את השורה `SH_ORIGIN` לכתובת האמיתית. תדחוף את השינוי.

- [ ] שונה ונדחף

### 4ב · באתר של אפל

App Groups ← הוסף `group.com.shavtzak.app`

Identifiers ← שלושה App IDs:

| Bundle ID | הרשאות |
|---|---|
| `com.shavtzak.app` | App Groups, Push Notifications |
| `com.shavtzak.app.widget` | App Groups |
| `com.shavtzak.app.notify` | App Groups |

בכל אחד, בתוך App Groups, סמן את הקבוצה.

Keys ← מפתח חדש עם APNs. יורד `.p8` פעם אחת בלבד.

- [ ] קבוצה
- [ ] שלושה מזהים
- [ ] מפתח APNs, ורשמת את ה־Key ID ואת ה־Team ID

### 4ג · ל־Cloudflare

```
npx wrangler secret put APNS_KEY_P8     # תוכן הקובץ כמו שהוא, עם שורות BEGIN ו-END
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
```

### 4ד · App Store Connect

אפליקציה חדשה עם `com.shavtzak.app`, שפה ראשית עברית.

Users and Access ← Integrations ← App Store Connect API ← מפתח חדש בתפקיד **App Manager**. יורד `.p8`, ורשום Key ID ו־Issuer ID.

### 4ה · סודות בגיטהאב

| שם | ערך |
|---|---|
| `APPLE_TEAM_ID` | ה־Team ID |
| `ASC_KEY_ID` | Key ID של App Store Connect |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | קובץ ה־p8 של App Store Connect ב־base64 |

`base64 -i AuthKey_XXXX.p8 | tr -d '\n'`

### 4ו · לבנות ולבדוק

Actions ← iOS ← Run workflow. עשר דקות, והבילד מופיע ב־TestFlight.

- [ ] נפתח ומראה את השבצ״ק
- [ ] הווידג׳ט מופיע ומראה את הדבר הבא
- [ ] הודעה מהניהול מגיעה כהתראה, עם הטקסט המלא ולא "יש עדכון"

הבדיקה האחרונה חשובה במיוחד. אם רואים "יש עדכון" בלבד, סימן שתוסף ההתראות לא מצליח להגיע לשרת.

### 4ז · להגשה

- [ ] צילומי מסך של 6.7 אינץ׳
- [ ] תיאור, מילות מפתח, קטגוריה Utilities
- [ ] קישור למדיניות פרטיות: הכתובת שלך ועוד `/privacy.html`
- [ ] **חשבון או קישור הדגמה** בשדה ההערות לבודק. בנה שבצ״ק עם שמות מומצאים וצור לו קישור קבוצתי ארוך טווח. אל תיתן לבודק גישה לשמות אמיתיים של אנשי היחידה
- [ ] בהערות לבודק, כתוב במפורש שיש ווידג׳ט והתראות. זה מה שמונע דחייה על "רק אתר בתוך מסגרת"

---

## מה שנשאר פתוח ולא קשור לחנויות

- `PICKER_API_KEY` כבר הוכנס. אם עוד לא הפעלת את Google Picker API בקונסולה של גוגל, אף אחד לא יוכל לחבר גיליון חדש
- משיכת עשרה אנשים למבצע של 24 שעות. בקשת את זה ועוד לא נבנה
- השאלה שנשארה פתוחה: האם כרמל ב צריך לקחת רק את המ״כ של הצוות היוצא, ולא את כולם
