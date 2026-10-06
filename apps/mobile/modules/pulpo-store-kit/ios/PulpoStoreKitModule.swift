import ExpoModulesCore
import StoreKit
import UIKit

private final class ProductUnavailableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The App Store product \(param) is unavailable"
  }
}

private final class InvalidAccountTokenException: Exception, @unchecked Sendable {
  override var reason: String {
    "The App Store account token must be a UUID"
  }
}

private final class NoActiveSceneException: Exception, @unchecked Sendable {
  override var reason: String {
    "Pulpo has no active window to show the App Store in"
  }
}

/// StoreKit 2 for Pulpo's auto-renewable subscriptions. The Pulpo server verifies Apple's
/// signed transactions before it grants a plan, so the app forwards them unchanged.
public final class PulpoStoreKitModule: Module, @unchecked Sendable {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("PulpoStoreKit")
    Events("onTransactionUpdated")

    // Renewals, Ask to Buy approvals, refunds, and purchases made on another device arrive
    // through Transaction.updates while the app runs.
    OnStartObserving("onTransactionUpdated") { [weak self] in
      self?.updates?.cancel()
      self?.updates = Task { [weak self] in
        for await verification in Transaction.updates {
          guard let record = await transactionRecord(verification) else { continue }
          self?.sendEvent("onTransactionUpdated", record)
        }
      }
    }

    OnStopObserving("onTransactionUpdated") { [weak self] in
      self?.updates?.cancel()
      self?.updates = nil
    }

    OnDestroy { [weak self] in
      self?.updates?.cancel()
    }

    AsyncFunction("canMakePayments") { () -> Bool in
      AppStore.canMakePayments
    }

    AsyncFunction("getProducts") { (productIds: [String], promise: Promise) in
      Task {
        do {
          let products = try await Product.products(for: productIds)
          promise.resolve(products.map(productRecord))
        } catch {
          promise.reject(error)
        }
      }
    }

    AsyncFunction("purchase") { (productId: String, appAccountToken: String, promise: Promise) in
      Task {
        do {
          guard let token = UUID(uuidString: appAccountToken) else { throw InvalidAccountTokenException() }
          guard let product = try await Product.products(for: [productId]).first else {
            throw ProductUnavailableException(productId)
          }
          switch try await purchase(product, appAccountToken: token) {
          case .success(let verification):
            var result: [String: Any] = ["status": "purchased"]
            if let record = await transactionRecord(verification) { result["transaction"] = record }
            promise.resolve(result)
          case .pending:
            promise.resolve(["status": "pending"])
          case .userCancelled:
            promise.resolve(["status": "cancelled"])
          @unknown default:
            promise.resolve(["status": "cancelled"])
          }
        } catch {
          promise.reject(error)
        }
      }
    }

    // Call once Pulpo's server has recorded the transaction. Unfinished transactions are
    // delivered again on the next launch.
    AsyncFunction("finishTransaction") { (transactionId: String, promise: Promise) in
      Task {
        for await verification in Transaction.unfinished {
          let transaction = verification.unsafePayloadValue
          if String(transaction.id) == transactionId { await transaction.finish() }
        }
        promise.resolve(nil)
      }
    }

    AsyncFunction("unfinishedTransactions") { (promise: Promise) in
      Task {
        var records: [[String: Any]] = []
        for await verification in Transaction.unfinished {
          if let record = await transactionRecord(verification) { records.append(record) }
        }
        promise.resolve(records)
      }
    }

    AsyncFunction("currentEntitlements") { (promise: Promise) in
      Task {
        var records: [[String: Any]] = []
        for await verification in Transaction.currentEntitlements {
          if let record = await transactionRecord(verification) { records.append(record) }
        }
        promise.resolve(records)
      }
    }

    // Restore Purchases: asks the App Store for this Apple Account's transactions. It can
    // prompt the person to sign in, so only call it from a button they tapped.
    AsyncFunction("sync") { (promise: Promise) in
      Task {
        do {
          try await AppStore.sync()
          promise.resolve(nil)
        } catch {
          promise.reject(error)
        }
      }
    }

    AsyncFunction("showManageSubscriptions") { (promise: Promise) in
      Task {
        do {
          try await showManageSubscriptions()
          promise.resolve(nil)
        } catch {
          promise.reject(error)
        }
      }
    }
  }
}

@MainActor
private func activeScene() -> UIWindowScene? {
  let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
  return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
}

@MainActor
private func purchase(_ product: Product, appAccountToken: UUID) async throws -> Product.PurchaseResult {
  guard let scene = activeScene() else { throw NoActiveSceneException() }
  // The token ties the purchase to the Pulpo account so the server can refuse to move it to another one.
  return try await product.purchase(confirmIn: scene, options: [.appAccountToken(appAccountToken)])
}

@MainActor
private func showManageSubscriptions() async throws {
  guard let scene = activeScene() else { throw NoActiveSceneException() }
  try await AppStore.showManageSubscriptions(in: scene)
}

private func periodUnit(_ unit: Product.SubscriptionPeriod.Unit) -> String {
  switch unit {
  case .day: return "day"
  case .week: return "week"
  case .month: return "month"
  case .year: return "year"
  @unknown default: return "month"
  }
}

private func productRecord(_ product: Product) -> [String: Any] {
  var record: [String: Any] = [
    "id": product.id,
    "displayName": product.displayName,
    "description": product.description,
    // Localized for the person's App Store storefront, including currency.
    "displayPrice": product.displayPrice,
  ]
  if let subscription = product.subscription {
    record["period"] = [
      "unit": periodUnit(subscription.subscriptionPeriod.unit),
      "value": subscription.subscriptionPeriod.value,
    ]
  }
  return record
}

/// A subscription transaction with its renewal info, both as Apple-signed JWS for the server.
private func transactionRecord(_ verification: VerificationResult<Transaction>) async -> [String: Any]? {
  let transaction = verification.unsafePayloadValue
  guard transaction.productType == .autoRenewable else { return nil }
  var record: [String: Any] = [
    "transactionId": String(transaction.id),
    "originalTransactionId": String(transaction.originalID),
    "productId": transaction.productID,
    "signedTransaction": verification.jwsRepresentation,
    "revoked": transaction.revocationDate != nil,
  ]
  if let token = transaction.appAccountToken { record["appAccountToken"] = token.uuidString.lowercased() }
  if let expiration = transaction.expirationDate { record["expiresAt"] = expiration.timeIntervalSince1970 * 1_000 }
  if let status = await transaction.subscriptionStatus {
    record["signedRenewalInfo"] = status.renewalInfo.jwsRepresentation
  }
  return record
}
