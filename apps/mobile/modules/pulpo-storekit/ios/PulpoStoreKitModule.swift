import ExpoModulesCore
import StoreKit
import UIKit

private final class ProductNotFoundException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The App Store did not return the product \(param)"
  }
}

private final class InvalidAccountTokenException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "\(param) is not a valid App Store account token"
  }
}

private final class UnverifiedPurchaseException: Exception, @unchecked Sendable {
  override var reason: String {
    "The App Store could not verify this purchase"
  }
}

private final class NoWindowSceneException: Exception, @unchecked Sendable {
  override var reason: String {
    "Pulpo has no active window to show subscriptions in"
  }
}

/// StoreKit 2 for Pulpo's subscriptions. The server is the source of truth for plans, so this module
/// only hands signed transactions to JavaScript, which reports them before finishing them.
public final class PulpoStoreKitModule: Module {
  private var updates: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("PulpoStoreKit")

    Events("onTransaction")

    // Renewals, purchases approved later (Ask to Buy), and purchases made on other devices.
    OnStartObserving("onTransaction") {
      self.updates?.cancel()
      self.updates = Task { [weak self] in
        for await result in Transaction.updates {
          guard let payload = Self.payload(result) else { continue }
          self?.sendEvent("onTransaction", payload)
        }
      }
    }

    OnStopObserving("onTransaction") {
      self.updates?.cancel()
      self.updates = nil
    }

    OnDestroy {
      self.updates?.cancel()
    }

    AsyncFunction("environment") { () async -> String? in
      if let result = try? await AppTransaction.shared {
        switch result {
        case .verified(let transaction), .unverified(let transaction, _):
          return Self.environmentName(transaction.environment)
        }
      }
      // TestFlight and development builds carry a sandbox receipt.
      guard let receipt = Bundle.main.appStoreReceiptURL else { return nil }
      return receipt.lastPathComponent == "sandboxReceipt" ? "sandbox" : "production"
    }

    AsyncFunction("products") { (ids: [String]) async throws -> [[String: Any]] in
      let products = try await Product.products(for: ids)
      return products.map { product in
        var value: [String: Any] = [
          "id": product.id,
          "displayName": product.displayName,
          "description": product.description,
          "displayPrice": product.displayPrice,
          "periodUnit": NSNull(),
          "periodValue": NSNull(),
        ]
        if let period = product.subscription?.subscriptionPeriod {
          value["periodUnit"] = Self.unitName(period.unit)
          value["periodValue"] = period.value
        }
        return value
      }
    }

    AsyncFunction("purchase") { (productId: String, appAccountToken: String) async throws -> [String: Any] in
      guard let token = UUID(uuidString: appAccountToken) else {
        throw InvalidAccountTokenException(appAccountToken)
      }
      guard let product = try await Product.products(for: [productId]).first else {
        throw ProductNotFoundException(productId)
      }
      let options: Set<Product.PurchaseOption> = [.appAccountToken(token)]
      let result: Product.PurchaseResult
      if let scene = await Self.activeWindowScene() {
        result = try await product.purchase(confirmIn: scene, options: options)
      } else {
        result = try await product.purchase(options: options)
      }
      switch result {
      case .success(let verification):
        guard var payload = Self.payload(verification) else { throw UnverifiedPurchaseException() }
        payload["status"] = "purchased"
        return payload
      case .pending:
        return ["status": "pending"]
      case .userCancelled:
        return ["status": "cancelled"]
      @unknown default:
        return ["status": "cancelled"]
      }
    }

    AsyncFunction("finish") { (transactionId: String) async in
      for await result in Transaction.unfinished {
        guard case .verified(let transaction) = result, String(transaction.id) == transactionId else { continue }
        await transaction.finish()
      }
    }

    AsyncFunction("unfinished") { () async -> [[String: Any]] in
      var transactions: [[String: Any]] = []
      for await result in Transaction.unfinished {
        if let payload = Self.payload(result) { transactions.append(payload) }
      }
      return transactions
    }

    AsyncFunction("currentEntitlements") { () async -> [[String: Any]] in
      var transactions: [[String: Any]] = []
      for await result in Transaction.currentEntitlements {
        if let payload = Self.payload(result) { transactions.append(payload) }
      }
      return transactions
    }

    AsyncFunction("sync") { () async throws in
      try await AppStore.sync()
    }

    AsyncFunction("showManageSubscriptions") { () async throws in
      guard let scene = await Self.activeWindowScene() else { throw NoWindowSceneException() }
      try await AppStore.showManageSubscriptions(in: scene)
    }
  }

  /// Transactions the device could not verify are left for StoreKit to retry rather than reported.
  private static func payload(_ result: VerificationResult<Transaction>) -> [String: Any]? {
    guard case .verified(let transaction) = result else { return nil }
    return [
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "productId": transaction.productID,
      "signedTransaction": result.jwsRepresentation,
    ]
  }

  private static func environmentName(_ environment: AppStore.Environment) -> String? {
    switch environment {
    case .production: return "production"
    case .sandbox: return "sandbox"
    case .xcode: return "xcode"
    default: return nil
    }
  }

  private static func unitName(_ unit: Product.SubscriptionPeriod.Unit) -> String? {
    switch unit {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return nil
    }
  }

  @MainActor
  private static func activeWindowScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }
}
