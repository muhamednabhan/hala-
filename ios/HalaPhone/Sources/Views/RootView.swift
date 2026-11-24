import SwiftUI

struct RootView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var calls: CallCoordinator
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        TabView(selection: $state.tab) {
            RecentsView()
                .tabItem { Label("Recents", systemImage: "clock.fill") }
                .tag(AppTab.recents)
            ContactsView()
                .tabItem { Label("Contacts", systemImage: "person.crop.circle.fill") }
                .tag(AppTab.contacts)
            KeypadView()
                .tabItem { Label("Keypad", systemImage: "circle.grid.3x3.fill") }
                .tag(AppTab.keypad)
            MessagesView()
                .tabItem { Label("Messages", systemImage: "message.fill") }
                .badge(state.unreadForActive)
                .tag(AppTab.messages)
            LinesView()
                .tabItem { Label("Lines", systemImage: "simcard.fill") }
                .tag(AppTab.lines)
        }
        .overlay(alignment: .top) { toast }
        .fullScreenCover(isPresented: Binding(
            get: { calls.call != nil },
            set: { if !$0 { calls.call = nil } }
        )) {
            CallView()
        }
        .task {
            calls.attach(state)
            if state.demoMode {
                if let mode = DemoData.callMode { showDemoCall(mode) }
                return
            }
            Notifier.shared.setUp()
            if state.data.server.isEmpty {
                // First launch with no server: point at the Lines tab instead of failing quietly later.
                state.tab = .lines
                state.showToast("Scan the QR code on the robot, or enter the server address.")
            }
            state.announceLine()
            state.startPolling()
            calls.prefetchToken()
            SoundPlayer.shared.setKeepAlive(state.data.keepAlive)
        }
        .onChange(of: scenePhase) { _, phase in
            guard !state.demoMode else { return }
            switch phase {
            case .active:
                state.startPolling()
                calls.prefetchToken()
                state.markReadIfVisible()
            case .background:
                if !state.data.keepAlive { state.stopPolling() }
            default:
                break
            }
        }
        .onOpenURL { state.handle(url: $0) }
    }

    @ViewBuilder
    private var toast: some View {
        if let text = state.toast {
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { state.toast = nil }
        }
    }

    private func showDemoCall(_ mode: String) {
        switch mode {
        case "incoming": calls.showDemo(.ringing, incoming: true)
        case "failed": calls.showDemo(.failed("The number you dialled isn't available. Dial 800 4252 to reach HALA."))
        case "calling": calls.showDemo(.calling)
        default: calls.showDemo(.connected)
        }
    }
}

extension AppState {
    func markReadIfVisible() { if isThreadOpen { markRead() } }
}
