import Foundation
import SwiftUI

struct AppLogsView: View {
  @Bindable var model: AgentSession
  let app: AppSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if model.isLoadingLogs(for: app.name) {
        DetailLoadingText("Loading logs...")
          .frame(maxWidth: .infinity, alignment: .leading)
      } else if let error = model.appLogErrors[app.name] {
        DetailEmptyText(error)
      } else if let response = model.appLogs[app.name] {
        if response.logs.isEmpty {
          DetailEmptyText("No recent logs.")
        } else {
          ScrollView {
            VStack(alignment: .leading, spacing: 8) {
              ForEach(response.logs.suffix(40)) { line in
                VStack(alignment: .leading, spacing: 2) {
                  if let timestamp = line.timestampText {
                    Text(timestamp)
                      .font(.caption2)
                      .foregroundStyle(.secondary)
                  }
                  Text(ANSILogTextParser.attributedString(from: line.message.isEmpty ? line.raw : line.message))
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(2)
                    .truncationMode(.tail)
                }
              }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 7))
        }
      } else {
        Button {
          Task { await model.loadLogs(for: app.name) }
        } label: {
          Label("Load latest logs", systemImage: "arrow.down.circle")
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .font(.caption)
        .padding(.vertical, 3)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .onAppear {
      guard model.appLogs[app.name] == nil else {
        return
      }
      Task { await model.loadLogs(for: app.name) }
    }
  }
}

private enum ANSILogTextParser {
  static func attributedString(from input: String) -> AttributedString {
    var output = AttributedString()
    var buffer = ""
    var style = ANSITextStyle()
    var index = input.startIndex

    func flushBuffer() {
      guard !buffer.isEmpty else {
        return
      }
      var run = AttributedString(buffer)
      style.apply(to: &run)
      output += run
      buffer.removeAll(keepingCapacity: true)
    }

    while index < input.endIndex {
      let character = input[index]

      if character == "\u{001B}" {
        flushBuffer()
        index = input.index(after: index)
        guard index < input.endIndex else {
          break
        }

        switch input[index] {
        case "[":
          index = consumeCSI(in: input, from: input.index(after: index), style: &style)
        case "]":
          index = consumeOSC(in: input, from: input.index(after: index))
        default:
          index = input.index(after: index)
        }
      } else if character == "\u{009B}" {
        flushBuffer()
        index = consumeCSI(in: input, from: input.index(after: index), style: &style)
      } else if character == "\u{009D}" {
        flushBuffer()
        index = consumeOSC(in: input, from: input.index(after: index))
      } else if isHiddenControl(character) {
        index = input.index(after: index)
      } else {
        buffer.append(character)
        index = input.index(after: index)
      }
    }

    flushBuffer()
    return output
  }

  private static func consumeCSI(
    in input: String,
    from startIndex: String.Index,
    style: inout ANSITextStyle
  ) -> String.Index {
    var index = startIndex
    var payload = ""

    while index < input.endIndex {
      guard let scalar = input[index].unicodeScalars.first else {
        index = input.index(after: index)
        continue
      }

      if scalar.value >= 0x40, scalar.value <= 0x7E {
        if input[index] == "m" {
          style.applySGR(payload)
        }
        return input.index(after: index)
      }

      payload.append(input[index])
      index = input.index(after: index)
    }

    return index
  }

  private static func consumeOSC(in input: String, from startIndex: String.Index) -> String.Index {
    var index = startIndex

    while index < input.endIndex {
      if input[index] == "\u{0007}" {
        return input.index(after: index)
      }

      if input[index] == "\u{001B}" {
        let nextIndex = input.index(after: index)
        if nextIndex < input.endIndex, input[nextIndex] == "\\" {
          return input.index(after: nextIndex)
        }
      }

      index = input.index(after: index)
    }

    return index
  }

  private static func isHiddenControl(_ character: Character) -> Bool {
    guard let scalar = character.unicodeScalars.first, character.unicodeScalars.count == 1 else {
      return false
    }
    if scalar == "\t" || scalar == "\n" {
      return false
    }
    return scalar.value < 0x20 || scalar.value == 0x7F
  }
}

private struct ANSITextStyle {
  var foreground: Color?
  var background: Color?
  var isBold = false
  var isDim = false
  var isItalic = false
  var isUnderlined = false
  var isStruckThrough = false
  var isInverted = false

  func apply(to attributedString: inout AttributedString) {
    var effectiveForeground = foreground
    var effectiveBackground = background

    if isInverted {
      effectiveForeground = background ?? .primary
      effectiveBackground = foreground
    }

    if let effectiveForeground {
      attributedString.foregroundColor = isDim ? effectiveForeground.opacity(0.65) : effectiveForeground
    } else if isDim {
      attributedString.foregroundColor = .secondary
    }

    if let effectiveBackground {
      attributedString.backgroundColor = effectiveBackground.opacity(0.28)
    }

    var intent = InlinePresentationIntent()
    if isBold {
      intent.insert(.stronglyEmphasized)
    }
    if isItalic {
      intent.insert(.emphasized)
    }
    if !intent.isEmpty {
      attributedString.inlinePresentationIntent = intent
    }

    if isUnderlined {
      attributedString.underlineStyle = Text.LineStyle(pattern: .solid, color: effectiveForeground)
    }
    if isStruckThrough {
      attributedString.strikethroughStyle = Text.LineStyle(pattern: .solid, color: effectiveForeground)
    }
  }

  mutating func applySGR(_ payload: String) {
    let codes = payload.isEmpty ? [0] : payload.split(separator: ";", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
    var index = 0

    while index < codes.count {
      switch codes[index] {
      case 0:
        self = ANSITextStyle()
      case 1:
        isBold = true
      case 2:
        isDim = true
      case 3:
        isItalic = true
      case 4:
        isUnderlined = true
      case 7:
        isInverted = true
      case 9:
        isStruckThrough = true
      case 22:
        isBold = false
        isDim = false
      case 23:
        isItalic = false
      case 24:
        isUnderlined = false
      case 27:
        isInverted = false
      case 29:
        isStruckThrough = false
      case 30 ... 37:
        foreground = ansiColor(codes[index] - 30, bright: false)
      case 39:
        foreground = nil
      case 40 ... 47:
        background = ansiColor(codes[index] - 40, bright: false)
      case 49:
        background = nil
      case 90 ... 97:
        foreground = ansiColor(codes[index] - 90, bright: true)
      case 100 ... 107:
        background = ansiColor(codes[index] - 100, bright: true)
      case 38, 48:
        let parsedColor = extendedColor(from: codes, startingAt: index)
        if codes[index] == 38 {
          foreground = parsedColor.color
        } else {
          background = parsedColor.color
        }
        index = parsedColor.nextIndex
      default:
        break
      }

      index += 1
    }
  }

  private func extendedColor(from codes: [Int], startingAt index: Int) -> (color: Color?, nextIndex: Int) {
    guard index + 1 < codes.count else {
      return (nil, index)
    }

    switch codes[index + 1] {
    case 5:
      guard index + 2 < codes.count else {
        return (nil, index + 1)
      }
      return (xtermColor(codes[index + 2]), index + 2)
    case 2:
      guard index + 4 < codes.count else {
        return (nil, index + 1)
      }
      return (rgbColor(red: codes[index + 2], green: codes[index + 3], blue: codes[index + 4]), index + 4)
    default:
      return (nil, index + 1)
    }
  }

  private func ansiColor(_ value: Int, bright: Bool) -> Color {
    switch (value, bright) {
    case (0, false):
      .primary
    case (0, true):
      .secondary
    case (1, false):
      .red
    case (1, true):
      Color(red: 1.0, green: 0.38, blue: 0.34)
    case (2, false):
      .green
    case (2, true):
      Color(red: 0.38, green: 0.85, blue: 0.42)
    case (3, false):
      .yellow
    case (3, true):
      Color(red: 1.0, green: 0.82, blue: 0.28)
    case (4, false):
      .blue
    case (4, true):
      Color(red: 0.42, green: 0.68, blue: 1.0)
    case (5, false):
      .purple
    case (5, true):
      Color(red: 0.86, green: 0.50, blue: 1.0)
    case (6, false):
      .cyan
    case (6, true):
      Color(red: 0.36, green: 0.86, blue: 0.92)
    default:
      .primary
    }
  }

  private func xtermColor(_ value: Int) -> Color? {
    guard value >= 0, value <= 255 else {
      return nil
    }

    if value < 16 {
      return ansiColor(value % 8, bright: value >= 8)
    }

    if value >= 232 {
      let level = Double(8 + ((value - 232) * 10)) / 255
      return Color(red: level, green: level, blue: level)
    }

    let cubeIndex = value - 16
    let red = cubeIndex / 36
    let green = (cubeIndex % 36) / 6
    let blue = cubeIndex % 6
    return rgbColor(
      red: xtermCubeLevel(red),
      green: xtermCubeLevel(green),
      blue: xtermCubeLevel(blue)
    )
  }

  private func xtermCubeLevel(_ value: Int) -> Int {
    value == 0 ? 0 : 55 + (value * 40)
  }

  private func rgbColor(red: Int, green: Int, blue: Int) -> Color {
    Color(
      red: Double(clampedChannel(red)) / 255,
      green: Double(clampedChannel(green)) / 255,
      blue: Double(clampedChannel(blue)) / 255
    )
  }

  private func clampedChannel(_ value: Int) -> Int {
    min(max(value, 0), 255)
  }
}

#Preview {
  AppLogsView(
    model: .previewForAppLogs,
    app: .previewLogsApp
  )
  .padding()
  .frame(width: 460, height: 480)
}

private extension AgentSession {
  static var previewForAppLogs: AgentSession {
    let session = AgentSession()
    session.status = .ready
    session.appLogs[AppSummary.previewLogsApp.name] = AppLogsResponse(
      status: "ok",
      app: AppSummary.previewLogsApp.name,
      lines: 100,
      logs: [
        LogLine(
          index: 0,
          raw: "2026-05-17T16:08:10Z web.1 Starting server...",
          message: "web.1 Starting server...",
          timestamp: "2026-05-17T16:08:10Z",
          timestampText: "4:08:10 PM",
          source: "web.1"
        ),
        LogLine(
          index: 1,
          raw: "2026-05-17T16:08:12Z web.1 Listening on port 5000",
          message: "web.1 Listening on port 5000",
          timestamp: "2026-05-17T16:08:12Z",
          timestampText: "4:08:12 PM",
          source: "web.1"
        ),
        LogLine(
          index: 2,
          raw: "2026-05-17T16:08:22Z web.1 \u{001B}[32mCompleted 200 OK\u{001B}[0m",
          message: "web.1 \u{001B}[32mCompleted 200 OK\u{001B}[0m",
          timestamp: "2026-05-17T16:08:22Z",
          timestampText: "4:08:22 PM",
          source: "web.1"
        ),
        LogLine(
          index: 3,
          raw: "2026-05-17T16:08:35Z web.1 \u{001B}[1;33mCache warm\u{001B}[0m \u{001B}[38;5;39m35ms\u{001B}[0m",
          message: "web.1 \u{001B}[1;33mCache warm\u{001B}[0m \u{001B}[38;5;39m35ms\u{001B}[0m",
          timestamp: "2026-05-17T16:08:35Z",
          timestampText: "4:08:35 PM",
          source: "web.1"
        ),
      ],
      truncated: false
    )
    return session
  }
}

private extension AppSummary {
  static var previewLogsApp: AppSummary {
    AppSummary(
      name: "workouts",
      urls: ["https://workouts.home.bitcreative.net"],
      running: true,
      deployed: true,
      processCount: 1,
      httpsActive: true,
      containerStatus: "running",
      ports: "http:80:5000",
      domains: ["workouts.home.bitcreative.net"]
    )
  }
}
