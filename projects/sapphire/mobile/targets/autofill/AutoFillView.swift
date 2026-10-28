import SapphireVaultCore
import SwiftUI

struct AutoFillView: View {
  @ObservedObject var model: AutoFillModel

  var body: some View {
    NavigationStack {
      content
        .navigationTitle(model.mode == .oneTimeCode ? "Codes" : "Passwords")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { model.cancel() }
          }
        }
    }
  }

  @ViewBuilder
  private var content: some View {
    switch model.screen {
    case .loading:
      ProgressView()
    case .message(let message, let retry):
      VStack(spacing: 16) {
        Text(message)
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
        if let retry {
          Button("Unlock", action: retry)
            .buttonStyle(.borderedProminent)
        }
      }
      .padding()
    case .list(let suggested, let all, let domain):
      list(suggested: suggested, all: all, domain: domain)
    }
  }

  private func list(suggested: [VaultItemSummary], all: [VaultItemSummary], domain: String?) -> some View {
    let query = model.search.trimmingCharacters(in: .whitespaces)
    let filtered = query.isEmpty ? all : all.filter { matches($0, query) }

    return List {
      if query.isEmpty && !suggested.isEmpty {
        Section(domain.map { "For \($0)" } ?? "Suggested") {
          ForEach(suggested, id: \.id, content: row)
        }
      }
      Section(query.isEmpty ? "All items" : "Results") {
        if filtered.isEmpty {
          Text("No items").foregroundStyle(.secondary)
        }
        ForEach(filtered, id: \.id, content: row)
      }
    }
    .searchable(text: $model.search, placement: .navigationBarDrawer(displayMode: .always))
  }

  private func row(_ summary: VaultItemSummary) -> some View {
    Button {
      model.select(id: summary.id)
    } label: {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 4) {
          Text(summary.name).foregroundStyle(.primary)
          if summary.favorite {
            Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
          }
        }
        if let username = summary.username {
          Text(username).font(.subheadline).foregroundStyle(.secondary)
        }
      }
    }
  }

  private func matches(_ summary: VaultItemSummary, _ query: String) -> Bool {
    let fields = [summary.name, summary.username ?? ""] + summary.uris.map(\.uri)
    return fields.contains { $0.localizedCaseInsensitiveContains(query) }
  }
}
