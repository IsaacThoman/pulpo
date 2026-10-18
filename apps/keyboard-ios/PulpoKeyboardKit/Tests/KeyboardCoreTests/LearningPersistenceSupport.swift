import Foundation
import Testing
@testable import KeyboardCore

/// Only a confirmed busy/no-admission result is retried. All other failures are
/// test failures; polling never converts an uncertain write into a fresh learn.
func learningEventually(_ operation: () -> Bool, result: () -> LearningPersistenceResult) throws {
  let deadline = ContinuousClock.now + .seconds(5)
  repeat {
    if operation() { return }
    guard result() == .busy else { throw LearningTestFailure.result(result()) }
    guard ContinuousClock.now < deadline else { throw LearningTestFailure.timeout }
    sched_yield()
  } while true
}
private enum LearningTestFailure: Error { case result(LearningPersistenceResult), timeout }

func finishLearning(_ personal: PersonalDictionary) throws {
  try learningEventually({ personal.save() }, result: { personal.persistenceResult })
  try learningEventually({ _ = personal.reloadIfChangedOnDisk(); return personal.persistenceResult == .ok }, result: { personal.persistenceResult })
}
func finishLearning(_ touch: TouchModel) throws {
  try learningEventually({ touch.save() }, result: { touch.persistenceResult })
  try learningEventually({ _ = touch.reloadIfChangedOnDisk(); return touch.persistenceResult == .ok }, result: { touch.persistenceResult })
}
