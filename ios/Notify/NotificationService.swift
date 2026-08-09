import UserNotifications

/// Rewrites the notification before it is shown.
///
/// Apple carries a placeholder: title "שבצ״ק", body "יש עדכון". Nothing else.
/// This extension runs for a few seconds before the banner appears, fetches the
/// real text over our own authenticated connection, and puts it in. That is the
/// same arrangement the browser version has always had, and it is the reason no
/// name and no hour of anybody's watch ever sits on Apple's servers.
///
/// If the fetch fails the placeholder is shown as-is. A vague notification is a
/// bad day; a missing one is a missed watch.
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var copy: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        handler = contentHandler
        copy = request.content.mutableCopy() as? UNMutableNotificationContent
        guard let content = copy else { return contentHandler(request.content) }

        Task {
            if let n = await fetch() {
                let (title, body) = text(for: n)
                if !title.isEmpty { content.title = title }
                if !body.isEmpty { content.body = body }
            }
            contentHandler(content)
        }
    }

    /// Called when the seconds run out. Whatever we have is better than nothing.
    override func serviceExtensionTimeWillExpire() {
        if let handler, let copy { handler(copy) }
    }

    private struct Notif: Decodable {
        var kind: String?
        var text: String?
        var from: String?
        var mins: Int?
        var post: String?
        var start: Double?
        var end: Double?
        var withMe: [String]?
        var when: Double?
    }

    private func fetch() async -> Notif? {
        guard let token = Shared.token,
              let url = URL(string: Shared.origin + "/api/notify/ext") else { return nil }
        var req = URLRequest(url: url)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 8
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(Notif.self, from: data)
    }

    private func hm(_ ms: Double?) -> String {
        guard let ms, ms > 0 else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "he_IL")
        f.timeZone = TimeZone(identifier: "Asia/Jerusalem")
        f.dateFormat = "HH:mm"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }

    private func text(for n: Notif) -> (String, String) {
        switch n.kind {
        case "reminder":
            let mins = n.mins ?? 0
            let title = mins <= 1 ? "השמירה שלך מתחילה עכשיו" : "שמירה בעוד \(mins) דקות"
            var body = hm(n.start) + "–" + hm(n.end)
            if let post = n.post, !post.isEmpty { body += " · " + post }
            if let with = n.withMe, !with.isEmpty { body += "\nאיתך: " + with.joined(separator: ", ") }
            return (title, body)
        case "event":
            let mins = n.mins ?? 0
            let title = mins <= 1 ? "מתחיל עכשיו" : "בעוד \(mins) דקות"
            return (title, (n.text ?? "") + "\n" + hm(n.start))
        case "msg":
            let title = (n.from?.isEmpty == false) ? "הודעה מ" + n.from! : "הודעה מהמפקד"
            var body = n.text ?? ""
            if let w = n.when, w > 0 { body += "\n" + hm(w) }
            return (title, body)
        case "change":
            return ("השבצ״ק עודכן", "יש שינוי בשיבוצים שלך")
        default:
            return ("", "")
        }
    }
}
