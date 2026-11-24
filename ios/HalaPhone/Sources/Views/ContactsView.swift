import SwiftUI

/// Contacts: "My Card" (the active line) and HALA. The contact card has the four round action buttons
/// iOS shows, with message and call wired up.
struct ContactsView: View {
    @EnvironmentObject var state: AppState
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(Color(uiColor: .systemGray3))
                            Text(initials(state.activeLine.name))
                                .font(.system(size: 20, weight: .medium))
                                .foregroundStyle(.white)
                        }
                        .frame(width: 58, height: 58)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(state.activeLine.name).font(.system(size: 20, weight: .semibold))
                            Text("My Card").font(.system(size: 14)).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                if matches {
                    Section(header: Text("H")) {
                        NavigationLink {
                            ContactCard()
                        } label: {
                            Text(HALA.name).font(.system(size: 17, weight: .semibold))
                        }
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle("Contacts")
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")
        }
    }

    private var matches: Bool {
        search.isEmpty || HALA.name.localizedCaseInsensitiveContains(search) || HALA.displayNumber.contains(search)
    }

    private func initials(_ name: String) -> String {
        name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined().uppercased()
    }
}

struct ContactCard: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var calls: CallCoordinator

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HalaAvatar(size: 120).padding(.top, 8)
                Text(HALA.name)
                    .font(.system(size: 30, weight: .semibold))
                    .displayTracking(30)

                HStack(spacing: 10) {
                    action("message.fill", "message") {
                        state.tab = .messages
                        state.messagesPath = [state.activeLine.e164]
                    }
                    action("phone.fill", "call") { calls.startOutgoing(digits: HALA.dialNumber) }
                    action("video.fill", "video", enabled: false) {}
                    action("envelope.fill", "mail", enabled: false) {}
                }
                .padding(.horizontal, 16)

                VStack(spacing: 0) {
                    field("mobile", HALA.displayNumber, tint: Theme.blue)
                    Divider().padding(.leading, 16)
                    field("notes", "AI assistant for Dubai Silicon Oasis. Speaks Arabic and English. Fees and times it quotes are demo values.", tint: .primary)
                }
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(uiColor: .secondarySystemGroupedBackground)))
                .padding(.horizontal, 16)
            }
            .padding(.bottom, 24)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func action(_ symbol: String, _ title: String, enabled: Bool = true, perform: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            perform()
        } label: {
            VStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 20))
                Text(title).font(.system(size: 12))
            }
            .foregroundStyle(enabled ? Theme.blue : Color.secondary)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(uiColor: .secondarySystemGroupedBackground)))
        }
        .buttonStyle(PressableCircleStyle(pressedScale: 0.95))
        .disabled(!enabled)
    }

    private func field(_ label: String, _ value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 13)).foregroundStyle(.secondary)
            Text(value).font(.system(size: 17)).foregroundStyle(tint)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
