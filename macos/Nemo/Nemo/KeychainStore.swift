import Foundation
import Security

struct KeychainStore {
  private let service = "net.bitcreative.Nemo"

  func credential(account: String) throws -> String? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess else {
      throw KeychainError(status: status)
    }
    guard let data = item as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  func saveCredential(_ credential: String, account: String) throws {
    let data = Data(credential.utf8)
    var query = baseQuery(account: account)
    let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if updateStatus == errSecSuccess {
      return
    }
    if updateStatus != errSecItemNotFound {
      throw KeychainError(status: updateStatus)
    }

    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let addStatus = SecItemAdd(query as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw KeychainError(status: addStatus)
    }
  }

  func deleteCredential(account: String) throws {
    let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound {
      throw KeychainError(status: status)
    }
  }

  private func baseQuery(account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
  }
}

struct KeychainError: LocalizedError {
  let status: OSStatus

  var errorDescription: String? {
    SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
  }
}
