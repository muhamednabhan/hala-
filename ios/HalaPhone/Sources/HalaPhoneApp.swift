import SwiftUI

@main
struct HalaPhoneApp: App {
    @StateObject private var state = AppState()
    @StateObject private var calls = CallCoordinator()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .environmentObject(calls)
                .animation(.spring(response: 0.35, dampingFraction: 0.9), value: state.toast)
        }
    }
}
