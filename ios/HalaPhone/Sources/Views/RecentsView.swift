import SwiftUI

/// The Phone app's Recents tab: all calls, or only missed ones. Missed calls are red. Tapping a row calls back.
struct RecentsView: View {
    @EnvironmentObject var state: AppState
    @EnvironmentObject var calls: CallCoordinator
    @State private var missedOnly = false

    private var rows: [CallRecord] {
        missedOnly ? state.data.recents.filter { $0.direction == .missed } : state.data.recents
    }

    var body: some View {
        NavigationStack {
            Group {
                if rows.isEmpty {
                    VStack(spacing: 6) {
                        Text(missedOnly ? "No Missed Calls" : "No Recents")
                            .font(.title2.weight(.semibold))
                        Text("Calls to and from HALA show up here.")
                            .foregroundStyle(.secondary)
                    }
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(rows) { record in
                            Button { calls.startOutgoing(digits: HALA.dialNumber) } label: { row(record) }
                                .buttonStyle(.plain)
                        }
                        .onDelete { offsets in
                            let ids = offsets.map { rows[$0].id }
                            state.data.recents.removeAll { ids.contains($0.id) }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Recents")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Filter", selection: $missedOnly) {
                        Text("All").tag(false)
                        Text("Missed").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 170)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func row(_ r: CallRecord) -> some View {
        HStack(spacing: 10) {
            Image(systemName: r.direction == .outgoing ? "phone.arrow.up.right.fill" : "phone.arrow.down.left.fill")
                .font(.system(size: 13))
                .foregroundStyle(r.direction == .missed ? Theme.red : .secondary)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(HALA.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(r.direction == .missed ? Theme.red : .primary)
                Text(subtitle(r))
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(shortDate(r.date))
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
            Image(systemName: "info.circle")
                .font(.system(size: 20))
                .foregroundStyle(Theme.blue)
        }
        .contentShape(Rectangle())
    }

    private func subtitle(_ r: CallRecord) -> String {
        switch r.direction {
        case .missed: return "Missed call"
        case .incoming: return r.duration > 0 ? "Incoming · \(CallCoordinator.format(r.duration))" : "Declined"
        case .outgoing: return r.duration > 0 ? "Outgoing · \(CallCoordinator.format(r.duration))" : "Cancelled"
        }
    }
}
