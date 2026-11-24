import SwiftUI

/// The Messages app: a conversation list and the thread with HALA. Sent texts are green (SMS), HALA's
/// are grey, "Delivered" sits under the last one, and a typing bubble shows while the agent answers.
struct MessagesView: View {
    @EnvironmentObject var state: AppState
    @State private var search = ""

    var body: some View {
        NavigationStack(path: $state.messagesPath) {
            List {
                NavigationLink(value: state.activeLine.e164) { row }
                    .listRowInsets(EdgeInsets(top: 8, leading: 28, bottom: 8, trailing: 16))
            }
            .listStyle(.plain)
            .navigationTitle("Messages")
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Edit") { Haptics.tap() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.tap()
                        state.messagesPath = [state.activeLine.e164]
                    } label: { Image(systemName: "square.and.pencil") }
                    .accessibilityLabel("New message")
                }
            }
            .navigationDestination(for: String.self) { _ in ThreadView() }
        }
    }

    private var last: ChatMessage? { state.messages(for: state.activeLine.e164).last }
    private var unread: Int { state.unreadForActive }

    private var row: some View {
        HStack(spacing: 12) {
            HalaAvatar(size: 50)
                .overlay(alignment: .leading) {
                    if unread > 0 {
                        Circle().fill(Theme.blue).frame(width: 11, height: 11).offset(x: -19)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(HALA.shortName).font(.system(size: 17, weight: .semibold))
                    Spacer()
                    if let last { Text(shortDate(last.date)).font(.system(size: 15)).foregroundStyle(.secondary) }
                }
                Text(preview)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }

    private var preview: String {
        guard let last else { return "Text HALA to find a DSO service, book a slot or get help." }
        return last.kind == .voice ? "🎤 Voice message" : last.text
    }
}

struct ThreadView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var calls: CallCoordinator
    @FocusState private var focused: Bool

    private var key: String { state.activeLine.e164 }
    private var messages: [ChatMessage] { state.messages(for: key) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if messages.isEmpty { emptyHint }
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        if showsHeader(index) { dateHeader(message.date) }
                        bubble(message, index: index)
                            .padding(.top, spacing(index))
                        if isLastMine(index) { deliveryLabel(message) }
                    }
                    if state.typing[key] == true {
                        HStack { TypingBubble(); Spacer() }
                            .padding(.horizontal, 14)
                            .padding(.top, 8)
                            .transition(.scale(scale: 0.85, anchor: .bottomLeading).combined(with: .opacity))
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.vertical, 8)
                .animation(.spring(response: 0.35, dampingFraction: 0.85), value: messages.count)
                .animation(.spring(response: 0.3, dampingFraction: 0.85), value: state.typing[key])
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: messages.count) { _, _ in scrollToEnd(proxy) }
            .onChange(of: state.typing[key]) { _, _ in scrollToEnd(proxy) }
            .onChange(of: focused) { _, isFocused in if isFocused { scrollToEnd(proxy) } }
        }
        .background(Color(uiColor: .systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) { Composer(focused: $focused) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    HalaAvatar(size: 34)
                    HStack(spacing: 2) {
                        Text(HALA.shortName).font(.system(size: 11))
                        Image(systemName: "chevron.right").font(.system(size: 7, weight: .bold))
                    }
                    .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("HALA, AI assistant")
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { calls.startOutgoing(digits: HALA.dialNumber) } label: { Image(systemName: "phone") }
                    .accessibilityLabel("Call HALA")
            }
        }
        .onAppear {
            state.markRead()
            if state.focusComposer { focused = true; state.focusComposer = false }
        }
        .onChange(of: state.focusComposer) { _, want in
            if want { focused = true; state.focusComposer = false }
        }
    }

    // MARK: Layout helpers

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { proxy.scrollTo("bottom", anchor: .bottom) }
    }

    private func showsHeader(_ i: Int) -> Bool {
        guard i > 0 else { return true }
        return messages[i].date.timeIntervalSince(messages[i - 1].date) > 3600
    }

    private func isLastRun(_ i: Int) -> Bool {
        guard i + 1 < messages.count else { return true }
        return messages[i + 1].fromMe != messages[i].fromMe || showsHeader(i + 1)
    }

    private func spacing(_ i: Int) -> CGFloat {
        guard i > 0, !showsHeader(i) else { return 6 }
        return messages[i - 1].fromMe == messages[i].fromMe ? 2 : 8
    }

    private func isLastMine(_ i: Int) -> Bool {
        guard messages[i].fromMe else { return false }
        return !messages[(i + 1)...].contains(where: { $0.fromMe })
    }

    private func dateHeader(_ date: Date) -> some View {
        let cal = Calendar.current
        let day = cal.isDateInToday(date) ? "Today" : cal.isDateInYesterday(date) ? "Yesterday" : date.formatted(.dateTime.weekday(.wide).day().month())
        return Text("**\(day)** \(date.formatted(date: .omitted, time: .shortened))")
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 14)
            .padding(.bottom, 6)
    }

    @ViewBuilder
    private func bubble(_ m: ChatMessage, index: Int) -> some View {
        let tail = isLastRun(index)
        HStack {
            if m.fromMe { Spacer(minLength: 40) }
            Group {
                if m.kind == .voice && !m.fromMe {
                    VoiceBubble(message: m, showTail: tail)
                } else {
                    TextBubble(message: m, showTail: tail)
                }
            }
            .padding(.horizontal, tail ? 6 : 0)
            .onTapGesture { if m.state == .failed { state.resend(m.id) } }
            if !m.fromMe { Spacer(minLength: 40) }
        }
        .padding(.horizontal, 14)
    }

    @ViewBuilder
    private func deliveryLabel(_ m: ChatMessage) -> some View {
        HStack {
            Spacer()
            switch m.state {
            case .sending: Text("Sending…").foregroundStyle(.secondary)
            case .sent: Text("Delivered").foregroundStyle(.secondary)
            case .failed: Text("Not Delivered. Tap to retry").foregroundStyle(Theme.red)
            }
        }
        .font(.system(size: 12))
        .padding(.horizontal, 20)
        .padding(.top, 3)
    }

    private var emptyHint: some View {
        VStack(spacing: 8) {
            HalaAvatar(size: 64)
            Text("HALA").font(.system(size: 20, weight: .semibold))
            Text("An AI assistant for Dubai Silicon Oasis. Text it in English or Arabic.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Text("At the robot? Scan its QR code to link this number so you never have to say it out loud.")
                .font(.system(size: 13))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
        .padding(.horizontal, 36)
        .padding(.top, 48)
        .padding(.bottom, 24)
    }
}

/// The input bar: round plus button, capsule field that says "Text Message · SMS", and the send arrow.
struct Composer: View {
    @EnvironmentObject var state: AppState
    var focused: FocusState<Bool>.Binding

    private var canSend: Bool { !state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Menu {
                Toggle(isOn: $state.data.voiceReplies) {
                    Label("Reply with voice messages", systemImage: "waveform")
                }
                Button {
                    state.draft = "HALA "
                    focused.wrappedValue = true
                } label: {
                    Label("Enter a link code", systemImage: "qrcode")
                }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color(uiColor: .systemGray5)))
            }
            .tint(Color.secondary)
            .accessibilityLabel("More")

            HStack(alignment: .bottom, spacing: 4) {
                TextField(state.data.voiceReplies ? "Text Message · Voice reply" : "Text Message · SMS", text: $state.draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused(focused)
                    .font(.system(size: 17))
                    .padding(.leading, 14)
                    .padding(.vertical, 7)
                    .submitLabel(.send)
                    .onSubmit(send)
                Group {
                    if canSend {
                        Button(action: send) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 30))
                                .foregroundStyle(Theme.green)
                        }
                        .buttonStyle(PressableCircleStyle(pressedScale: 0.88))
                        .accessibilityLabel("Send")
                        .transition(.scale.combined(with: .opacity))
                    } else {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(.secondary)
                            .frame(width: 30, height: 30)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.trailing, 3)
                .padding(.bottom, 2)
                .animation(.spring(response: 0.25, dampingFraction: 0.8), value: canSend)
            }
            .overlay(RoundedRectangle(cornerRadius: 19, style: .continuous).stroke(Color(uiColor: .systemGray4), lineWidth: 1))
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private func send() {
        guard canSend else { return }
        let text = state.draft
        state.draft = ""
        state.send(text)
    }
}
