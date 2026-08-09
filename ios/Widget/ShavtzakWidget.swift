import WidgetKit
import SwiftUI

// MARK: - timeline

struct Entry: TimelineEntry {
    let date: Date
    let view: WidgetView
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), view: WidgetView(state: "soon", line1: "היום ב-14:00",
                                             line2: "שער ראשי", line3: "עד 18:00"))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(Entry(date: Date(), view: await current())) }
    }

    /// iOS decides when a widget may talk to the network, and it is stingy. So
    /// ask rarely and be right in between: the next few refresh points are put
    /// on the timeline at the moments the text actually changes — when the
    /// watch starts, when it ends — rather than every fifteen minutes for the
    /// sake of it.
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        Task {
            let view = await current()
            let now = Date()
            var dates: [Date] = []
            if let s = view.startDate, s > now { dates.append(s.addingTimeInterval(1)) }
            if let e = view.endDate, e > now { dates.append(e.addingTimeInterval(1)) }
            dates.append(now.addingTimeInterval(30 * 60))
            let next = dates.filter { $0 > now }.min() ?? now.addingTimeInterval(30 * 60)
            completion(Timeline(entries: [Entry(date: now, view: view)], policy: .after(next)))
        }
    }

    private func current() async -> WidgetView {
        if Shared.token == nil { return .signedOut }
        if let fresh = await WidgetAPI.fetch() { return fresh }
        return WidgetAPI.cached ?? .offline
    }
}

// MARK: - colours

private extension Color {
    static let shBack = Color(red: 11/255, green: 15/255, blue: 20/255)
    static let shAcc = Color(red: 45/255, green: 212/255, blue: 191/255)
    static let shOn = Color(red: 239/255, green: 68/255, blue: 68/255)
    static let shSoon = Color(red: 245/255, green: 158/255, blue: 11/255)
    static let shDim = Color.white.opacity(0.55)
}

private func accent(_ state: String) -> Color {
    switch state {
    case "on": return .shOn
    case "soon": return .shSoon
    case "free": return .shAcc
    default: return .shDim
    }
}

private func heading(_ state: String) -> String {
    switch state {
    case "on": return "בשמירה"
    case "soon": return "מתחיל עוד מעט"
    case "free": return "הבא שלך"
    default: return "שבצ״ק"
    }
}

// MARK: - views

/// The small square. One question, one answer: what is the next thing you have.
struct SmallView: View {
    let v: WidgetView
    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(accent(v.state)).frame(width: 7, height: 7)
                Text(heading(v.state)).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.shDim)
            }
            Spacer(minLength: 2)
            countdown
            Text(v.line1).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.shDim).lineLimit(1)
            if !v.line2.isEmpty {
                Text(v.line2).font(.system(size: 13, weight: .bold)).foregroundStyle(.white).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        .environment(\.layoutDirection, .rightToLeft)
    }

    /// Text(_, style: .timer) keeps counting without waking the widget again,
    /// which is the only way to show live minutes inside Apple's refresh budget.
    @ViewBuilder private var countdown: some View {
        if v.state == "on", let end = v.endDate {
            Text(end, style: .timer)
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .monospacedDigit().foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
        } else if let start = v.startDate, v.state != "none" {
            Text(start, style: .timer)
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .monospacedDigit().foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
        } else {
            Text(v.line1.isEmpty ? "—" : v.line1)
                .font(.system(size: 20, weight: .heavy)).foregroundStyle(.white)
                .lineLimit(2).minimumScaleFactor(0.6)
        }
    }
}

/// The wide one adds what comes after, because "and then?" is the second
/// question everybody asks.
struct MediumView: View {
    let v: WidgetView
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .trailing, spacing: 3) {
                HStack(spacing: 5) {
                    Circle().fill(accent(v.state)).frame(width: 7, height: 7)
                    Text(heading(v.state)).font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.shDim)
                }
                if v.state == "on", let end = v.endDate {
                    Text(end, style: .timer)
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .monospacedDigit().foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                } else if let start = v.startDate, v.state != "none" {
                    Text(start, style: .timer)
                        .font(.system(size: 30, weight: .heavy, design: .rounded))
                        .monospacedDigit().foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                } else {
                    Text(v.line1.isEmpty ? "—" : v.line1)
                        .font(.system(size: 22, weight: .heavy)).foregroundStyle(.white).lineLimit(2)
                }
                if !v.line2.isEmpty {
                    Text(v.line2).font(.system(size: 14, weight: .bold)).foregroundStyle(.white).lineLimit(1)
                }
                Text(v.line1).font(.system(size: 12)).foregroundStyle(Color.shDim).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)

            if !v.soon.isEmpty {
                VStack(alignment: .trailing, spacing: 5) {
                    Text("אחר כך").font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.shDim)
                    ForEach(v.soon.prefix(3), id: \.self) { item in
                        VStack(alignment: .trailing, spacing: 0) {
                            Text(item.label).font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white).lineLimit(1)
                            Text(item.when).font(.system(size: 11)).foregroundStyle(Color.shDim).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .environment(\.layoutDirection, .rightToLeft)
    }
}

/// The lock screen strip. Rendered monochrome by the system, so it carries no
/// colour of its own and has room for two lines at most.
struct LockView: View {
    let v: WidgetView
    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(v.line2.isEmpty ? heading(v.state) : v.line2)
                .font(.system(size: 13, weight: .semibold)).lineLimit(1)
            if v.state == "on", let end = v.endDate {
                Text(end, style: .timer).font(.system(size: 16, weight: .bold)).monospacedDigit().lineLimit(1)
            } else if let start = v.startDate, v.state != "none" {
                Text(start, style: .timer).font(.system(size: 16, weight: .bold)).monospacedDigit().lineLimit(1)
            } else {
                Text(v.line1).font(.system(size: 15, weight: .bold)).lineLimit(1)
            }
            Text(v.line1).font(.system(size: 11)).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .environment(\.layoutDirection, .rightToLeft)
    }
}

struct WidgetBody: View {
    @Environment(\.widgetFamily) var family
    let entry: Entry

    var body: some View {
        Group {
            switch family {
            case .systemMedium: MediumView(v: entry.view)
            case .accessoryRectangular: LockView(v: entry.view)
            default: SmallView(v: entry.view)
            }
        }
        .containerBackground(for: .widget) {
            family == .accessoryRectangular ? Color.clear : Color.shBack
        }
    }
}

// MARK: - the widget

struct ShavtzakWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ShavtzakNext", provider: Provider()) { entry in
            WidgetBody(entry: entry)
        }
        .configurationDisplayName("השמירה הבאה")
        .description("מה הדבר הבא שיש לך, ומתי.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

@main
struct ShavtzakWidgetBundle: WidgetBundle {
    var body: some Widget {
        ShavtzakWidget()
    }
}
