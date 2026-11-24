import SwiftUI

/// Colours and small building blocks that make the app read as stock iOS: system semantic colours
/// (so light and dark mode just work), Apple's own green/red/blue, and press feedback that responds on
/// touch-down with a spring, never on release.
enum Theme {
    /// iOS system green (the Phone app's call button, SMS bubbles).
    static let green = Color(red: 0.204, green: 0.780, blue: 0.349)
    static let red = Color(red: 1.0, green: 0.231, blue: 0.188)
    static let blue = Color(red: 0.0, green: 0.478, blue: 1.0)
    /// HALA brand teal, used only for HALA's own avatar and the call backdrop.
    static let hala = Color(red: 0.055, green: 0.42, blue: 0.36)
    static let halaLight = Color(red: 0.26, green: 0.76, blue: 0.64)

    static let keyFill = Color(uiColor: .systemGray5)
    static let received = Color(uiColor: .systemGray5)
}

/// A round button that shrinks the instant it is touched and springs back. Used for every circular
/// control (keypad, call buttons) so they all feel the same.
struct PressableCircleStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.92
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? pressedScale : 1)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .animation(.spring(response: 0.22, dampingFraction: 0.72), value: configuration.isPressed)
    }
}

/// HALA's contact picture: the brand gradient with a waveform, the way iOS shows a monogram.
struct HalaAvatar: View {
    var size: CGFloat = 44
    var body: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [Theme.halaLight, Theme.hala], startPoint: .top, endPoint: .bottom))
            Image(systemName: "waveform")
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Tracking that follows size, the way Apple sets type: tighter as it grows, looser when small.
extension View {
    func displayTracking(_ size: CGFloat) -> some View {
        tracking(size >= 28 ? -0.02 * size : (size <= 12 ? 0.4 : 0))
    }
}

/// "Today", "Yesterday", "Monday", "12/11/26": the Recents / Messages date style.
func shortDate(_ date: Date, now: Date = Date()) -> String {
    let cal = Calendar.current
    if cal.isDateInToday(date) {
        return date.formatted(date: .omitted, time: .shortened)
    }
    if cal.isDateInYesterday(date) { return "Yesterday" }
    if let days = cal.dateComponents([.day], from: date, to: now).day, days < 7 {
        return date.formatted(.dateTime.weekday(.wide))
    }
    return date.formatted(date: .numeric, time: .omitted)
}
