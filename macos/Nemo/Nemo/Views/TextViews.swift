import SwiftUI

struct DetailEmptyText: View {
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    Text(text)
      .font(.caption)
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.vertical, 3)
  }
}

struct DetailLoadingText: View {
  let text: String

  init(_ text: String) {
    self.text = text
  }

  var body: some View {
    HStack(spacing: 7) {
      ProgressView()
        .controlSize(.small)
      Text(text)
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 3)
  }
}
