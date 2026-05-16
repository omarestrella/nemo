import Foundation

struct HTTPJSONTransport {
    var endpoint: URL
    var credential: String?
    var session: URLSession = .shared

    func get<T: Decodable>(_ path: String) async throws -> T {
        var request = try request(path: path)
        request.httpMethod = "GET"
        return try await send(request)
    }

    func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        var request = try request(path: path)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func request(path: String) throws -> URLRequest {
        try validateEndpoint()
        guard let url = URL(string: path, relativeTo: endpoint)?.absoluteURL else {
            throw TransportError.invalidEndpoint
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credential {
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw TransportError.unreachable
            }
            if (200..<300).contains(httpResponse.statusCode) {
                return try JSONDecoder().decode(T.self, from: data)
            }
            if let body = try? JSONDecoder().decode(NemoAPIErrorBody.self, from: data) {
                throw TransportError.api(status: httpResponse.statusCode, code: body.error.code, message: body.error.message)
            }
            throw TransportError.httpStatus(httpResponse.statusCode)
        } catch let error as TransportError {
            throw error
        } catch let error as URLError {
            throw TransportError.url(error)
        } catch {
            throw TransportError.decoding(error)
        }
    }

    private func validateEndpoint() throws {
        guard let scheme = endpoint.scheme?.lowercased(),
              endpoint.host(percentEncoded: false) != nil,
              scheme == "http" || scheme == "https" else {
            throw TransportError.invalidEndpoint
        }
    }
}

enum TransportError: LocalizedError {
    case invalidEndpoint
    case unreachable
    case url(URLError)
    case httpStatus(Int)
    case api(status: Int, code: String, message: String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            return "Enter a valid HTTP or HTTPS endpoint."
        case .unreachable:
            return "Endpoint unreachable."
        case .url(let error):
            if error.code == .serverCertificateUntrusted || error.code == .secureConnectionFailed || error.code == .serverCertificateHasBadDate || error.code == .serverCertificateHasUnknownRoot {
                return "TLS or certificate validation failed."
            }
            return error.localizedDescription
        case .httpStatus(let status):
            return "Agent returned HTTP \(status)."
        case .api(let status, let code, let message):
            if status == 401 {
                return "Missing or invalid credential."
            }
            if code == "UNSUPPORTED_PLATFORM" {
                return "Agent reachable, but the platform command failed."
            }
            return "\(message) (\(code))"
        case .decoding:
            return "Unsupported agent response."
        }
    }
}
