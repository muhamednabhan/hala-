import SwiftUI

/// "Lines": the settings the demo needs. Pick which dummy number you are texting from, point the app at
/// the HALA server, and switch voice replies and background mode.
struct LinesView: View {
    @EnvironmentObject var state: AppState
    @State private var showAdd = false
    @State private var editing: Line?
    @State private var checking = false
    @State private var health: Bool?
    @State private var healthNote: String?
    @State private var demoNote: String?
    @State private var demoBusy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(state.data.lines) { line in
                        Button { state.selectLine(line.id) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.name).foregroundStyle(.primary)
                                    Text(line.number).font(.subheadline).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if line.id == state.activeLine.id {
                                    Image(systemName: "checkmark").foregroundStyle(Theme.blue).fontWeight(.semibold)
                                }
                            }
                        }
                        .swipeActions {
                            if state.data.lines.count > 1 {
                                Button(role: .destructive) { state.removeLine(line.id) } label: { Label("Delete", systemImage: "trash") }
                            }
                            Button { editing = line } label: { Label("Edit", systemImage: "pencil") }.tint(Theme.blue)
                        }
                    }
                    Button { showAdd = true } label: { Label("Add Line", systemImage: "plus.circle.fill") }
                } header: {
                    Text("My Number")
                } footer: {
                    Text("Switch lines to show HALA talking to different people. HALA sees the number you pick; nothing here is a real phone number.")
                }

                Section {
                    TextField("https://your-tunnel.trycloudflare.com", text: $state.data.server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    HStack {
                        Button("Test connection") { test() }.disabled(checking || state.data.server.isEmpty)
                        Spacer()
                        if checking { ProgressView() }
                        else if let health {
                            Image(systemName: health ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(health ? Theme.green : Theme.red)
                        }
                    }
                    if let healthNote { Text(healthNote).font(.footnote).foregroundStyle(.secondary) }
                } header: {
                    Text("HALA Server")
                } footer: {
                    Text("Scanning the QR code on the robot fills this in for you.")
                }

                Section("Messages") {
                    Toggle("Reply with voice messages", isOn: $state.data.voiceReplies)
                }

                Section {
                    Toggle("Start calls on speaker", isOn: $state.data.speakerDefault)
                    Toggle("Keep line open in background", isOn: Binding(
                        get: { state.data.keepAlive },
                        set: { state.data.keepAlive = $0; SoundPlayer.shared.setKeepAlive($0) }
                    ))
                } header: {
                    Text("Calls")
                } footer: {
                    Text("Lets HALA ring you while the app is in the background, by playing silence. Uses a little battery.")
                }

                Section {
                    Button { demo("reminder") } label: { Label("HALA calls me about my appointment", systemImage: "phone.arrow.down.left") }
                        .disabled(demoBusy || state.data.server.isEmpty)
                    Button { demo("hello") } label: { Label("HALA calls me (line check)", systemImage: "phone.badge.waveform") }
                        .disabled(demoBusy || state.data.server.isEmpty)
                    if let demoNote { Text(demoNote).font(.footnote).foregroundStyle(.secondary) }
                } header: {
                    Text("Try it")
                } footer: {
                    Text("Starts a call from HALA to the selected line. The first one books a demo appointment for this number, then HALA rings about it. Keep the app open, or switch on Keep line open.")
                }

                Section {
                    Button("Clear this conversation", role: .destructive) { state.clearConversation() }
                }

                Section("About") {
                    Text("HALA is an AI assistant for Dubai Silicon Oasis, not a person. Fees, times and bookings are demonstration values.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Lines")
            .sheet(isPresented: $showAdd) { LineForm(existing: nil) }
            .sheet(item: $editing) { line in LineForm(existing: line) }
        }
    }

    private func test() {
        checking = true
        health = nil
        healthNote = nil
        let api = state.api
        Task {
            let status = await api.status()
            checking = false
            health = status?.ok ?? false
            if let status {
                if status.ok {
                    healthNote = "Ready. Data: " + (status.store ?? "file") + "." + (status.hackClubAi == true ? " AI wording on." : "")
                } else {
                    healthNote = (status.missing ?? []).joined(separator: ". ")
                }
            } else {
                healthNote = "No answer from that address. Is the server and tunnel running?"
            }
            if status?.ok == true { Haptics.success() } else { Haptics.warning() }
        }
    }

    private func demo(_ kind: String) {
        let line = state.activeLine
        let api = state.api
        demoBusy = true
        demoNote = "Asking HALA to call " + line.number + "…"
        state.announceLine()
        Task {
            do {
                try await api.demoCall(phone: line.e164, kind: kind)
                demoNote = "HALA is calling. It rings within a couple of seconds."
                await state.pollOnce()
            } catch {
                demoNote = (error as? LocalizedError)?.errorDescription ?? "Could not start the call."
            }
            demoBusy = false
        }
    }
}

struct LineForm: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let existing: Line?
    @State private var name = ""
    @State private var number = ""
    @State private var language = "en"

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("+971 50 000 0000", text: $number).keyboardType(.phonePad)
                    Picker("HALA speaks", selection: $language) {
                        Text("English").tag("en")
                        Text("العربية").tag("ar")
                    }
                } footer: {
                    Text("Any number works. It only decides who HALA thinks it is talking to.")
                }
            }
            .navigationTitle(existing == nil ? "New Line" : "Edit Line")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || !Line.isPlausible(number))
                }
            }
            .onAppear {
                if let existing { name = existing.name; number = existing.number; language = existing.language }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        if var line = existing {
            line.name = name.trimmingCharacters(in: .whitespaces)
            line.number = number.trimmingCharacters(in: .whitespaces)
            line.language = language
            state.updateLine(line)
        } else {
            state.addLine(name: name, number: number, language: language)
        }
        dismiss()
    }
}
