import SwiftUI

/// The Phone app's Keypad tab: big light number, round grey keys with letters, green call button.
struct KeypadView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var calls: CallCoordinator
    @State private var number = ""

    private let keys: [[(String, String)]] = [
        [("1", " "), ("2", "ABC"), ("3", "DEF")],
        [("4", "GHI"), ("5", "JKL"), ("6", "MNO")],
        [("7", "PQRS"), ("8", "TUV"), ("9", "WXYZ")],
        [("*", " "), ("0", "+"), ("#", " ")]
    ]
    private let keySize: CGFloat = 80
    private let spacing: CGFloat = 18

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 12)

            VStack(spacing: 6) {
                Text(display)
                    .font(.system(size: 38, weight: .light))
                    .displayTracking(38)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(height: 48)
                    .accessibilityLabel(number.isEmpty ? "No number entered" : display)
                Button("Add Number") { Haptics.tap() }
                    .font(.system(size: 17))
                    .opacity(number.isEmpty ? 0 : 1)
                    .disabled(number.isEmpty)
            }
            .padding(.horizontal, 32)
            .frame(height: 84)

            VStack(spacing: spacing) {
                ForEach(Array(keys.enumerated()), id: \.offset) { _, row in
                    HStack(spacing: spacing) {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, key in
                            keyButton(key.0, letters: key.1)
                        }
                    }
                }
                HStack(spacing: spacing) {
                    Color.clear.frame(width: keySize, height: keySize)
                    callButton
                    deleteButton
                }
            }
            .padding(.top, 14)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemBackground))
    }

    private var display: String {
        guard number.count == 7, number.allSatisfy(\.isNumber) else { return number }
        return String(number.prefix(3)) + " " + String(number.suffix(4))
    }

    private func keyButton(_ digit: String, letters: String) -> some View {
        Button {
            Haptics.tap()
            SoundPlayer.shared.keypadTone(digit)
            if number.count < 20 { number.append(digit) }
        } label: {
            VStack(spacing: -2) {
                Text(digit)
                    .font(.system(size: digit == "*" ? 44 : 36, weight: .regular))
                    .offset(y: digit == "*" ? 6 : 0)
                if letters != " " {
                    Text(letters)
                        .font(.system(size: 11, weight: .bold))
                        .tracking(2)
                } else {
                    Text(" ").font(.system(size: 11))
                }
            }
            .foregroundStyle(.primary)
            .frame(width: keySize, height: keySize)
            .background(Circle().fill(Theme.keyFill))
            .contentShape(Circle())
        }
        .buttonStyle(PressableCircleStyle(pressedScale: 0.94))
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5).onEnded { _ in
                if digit == "0" { Haptics.press(); if !number.isEmpty { number.removeLast() }; number.append("+") }
            }
        )
        .accessibilityLabel(digit == "*" ? "star" : digit == "#" ? "pound" : digit)
    }

    private var callButton: some View {
        Button {
            let target = number.isEmpty ? lastDialled : number
            if number.isEmpty { number = target }
            guard !target.isEmpty else { Haptics.warning(); return }
            calls.startOutgoing(digits: target)
        } label: {
            Image(systemName: "phone.fill")
                .font(.system(size: 32))
                .foregroundStyle(.white)
                .frame(width: keySize, height: keySize)
                .background(Circle().fill(Theme.green))
        }
        .buttonStyle(PressableCircleStyle())
        .accessibilityLabel("Call")
    }

    private var deleteButton: some View {
        Button {
            Haptics.tap()
            if !number.isEmpty { number.removeLast() }
        } label: {
            Image(systemName: "delete.left.fill")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
                .frame(width: keySize, height: keySize)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableCircleStyle(pressedScale: 0.88))
        .opacity(number.isEmpty ? 0 : 1)
        .disabled(number.isEmpty)
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.6).onEnded { _ in number = "" })
        .accessibilityLabel("Delete")
    }

    private var lastDialled: String {
        state.data.recents.first(where: { $0.direction == .outgoing })?.number.filter { $0.isNumber } ?? ""
    }
}
