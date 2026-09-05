import ExpoModulesCore
import UIKit

struct QueuedMessageRow: Record {
  @Field var id: String = ""
  @Field var content: String = ""
  @Field var detail: String = ""
  @Field var status: String = ""
  @Field var canEdit: Bool = false
  @Field var canDelete: Bool = false
  @Field var canReorder: Bool = false
}

/// UIKit supplies the long-press lift, insertion preview, autoscroll and drop animation.
public final class QueuedMessagesView: ExpoView, UITableViewDataSource, UITableViewDelegate, UITableViewDragDelegate, UITableViewDropDelegate {
  let onAction = EventDispatcher()
  private let table = UITableView(frame: .zero, style: .plain)
  private var rows: [QueuedMessageRow] = []

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    table.backgroundColor = .clear
    table.separatorStyle = .none
    table.dataSource = self
    table.delegate = self
    table.dragDelegate = self
    table.dropDelegate = self
    table.dragInteractionEnabled = true
    table.rowHeight = 80
    table.contentInsetAdjustmentBehavior = .never
    table.register(UITableViewCell.self, forCellReuseIdentifier: "queue")
    addSubview(table)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    table.frame = bounds
  }

  func setRows(_ value: [QueuedMessageRow]) {
    rows = value
    table.reloadData()
  }

  public func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

  public func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = rows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "queue", for: indexPath)
    cell.selectionStyle = .none
    cell.backgroundColor = .clear
    cell.contentView.subviews.forEach { $0.removeFromSuperview() }
    let card = UIView()
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 12
    card.translatesAutoresizingMaskIntoConstraints = false
    cell.contentView.addSubview(card)
    let text = UILabel()
    text.font = .preferredFont(forTextStyle: .subheadline)
    text.adjustsFontForContentSizeCategory = true
    text.numberOfLines = 2
    text.text = row.content
    let detail = UILabel()
    detail.font = .preferredFont(forTextStyle: .caption1)
    detail.textColor = .secondaryLabel
    detail.numberOfLines = 1
    detail.text = row.detail
    detail.isHidden = row.detail.isEmpty
    let labels = UIStackView(arrangedSubviews: [text, detail])
    labels.axis = .vertical
    labels.spacing = 3
    labels.isAccessibilityElement = true
    labels.accessibilityLabel = [row.content, row.detail].filter { !$0.isEmpty }.joined(separator: ", ")
    labels.accessibilityValue = row.status
    labels.accessibilityHint = row.canReorder ? "Touch and hold to reorder" : nil
    labels.accessibilityCustomActions = [-1, 1].compactMap { offset in
      let target = indexPath.row + offset
      guard row.canReorder, rows.indices.contains(target), rows[target].canReorder else { return nil }
      return UIAccessibilityCustomAction(name: offset < 0 ? "Move up" : "Move down") { [weak self] _ in
        self?.move(id: row.id, to: target)
        return true
      }
    }
    let stack = UIStackView(arrangedSubviews: [labels])
    stack.alignment = .center
    for (action, symbol, enabled) in [("edit", "pencil", row.canEdit), ("delete", "trash", row.canDelete)] {
      let button = UIButton(type: .system)
      button.setImage(UIImage(systemName: symbol), for: .normal)
      button.tintColor = .secondaryLabel
      button.isEnabled = enabled
      button.accessibilityLabel = "\(action.capitalized) queued message \(indexPath.row + 1)"
      button.addAction(UIAction { [weak self] _ in self?.onAction(["id": row.id, "action": action]) }, for: .touchUpInside)
      button.widthAnchor.constraint(equalToConstant: 44).isActive = true
      button.heightAnchor.constraint(equalToConstant: 44).isActive = true
      stack.addArrangedSubview(button)
    }
    stack.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(stack)
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor),
      card.trailingAnchor.constraint(equalTo: cell.contentView.trailingAnchor),
      card.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 2),
      card.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -2),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -4),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 8),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -8),
    ])
    return cell
  }

  public func tableView(_ tableView: UITableView, itemsForBeginning session: UIDragSession, at indexPath: IndexPath) -> [UIDragItem] {
    guard rows[indexPath.row].canReorder else { return [] }
    session.localContext = self
    let item = UIDragItem(itemProvider: NSItemProvider(object: rows[indexPath.row].id as NSString))
    item.localObject = rows[indexPath.row].id
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    return [item]
  }

  public func tableView(_ tableView: UITableView, dropSessionDidUpdate session: UIDropSession, withDestinationIndexPath destinationIndexPath: IndexPath?) -> UITableViewDropProposal {
    guard session.localDragSession?.localContext as? QueuedMessagesView === self,
      let id = session.items.first?.localObject as? String,
      rows.contains(where: { $0.id == id && $0.canReorder }),
      let destination = destinationIndexPath, !rows.isEmpty,
      rows[min(destination.row, rows.count - 1)].canReorder else {
      return UITableViewDropProposal(operation: .forbidden)
    }
    return UITableViewDropProposal(operation: .move, intent: .insertAtDestinationIndexPath)
  }

  private func move(id: String, to destination: Int) {
    guard let source = rows.firstIndex(where: { $0.id == id }),
      rows.indices.contains(destination), source != destination,
      rows[source].canReorder, rows[destination].canReorder else { return }
    let target = rows[destination].id
    let row = rows.remove(at: source)
    rows.insert(row, at: destination)
    table.moveRow(at: IndexPath(row: source, section: 0), to: IndexPath(row: destination, section: 0))
    UISelectionFeedbackGenerator().selectionChanged()
    onAction(["id": id, "action": "reorder", "targetMessageId": target, "edge": source < destination ? "after" : "before"])
  }

  public func tableView(_ tableView: UITableView, performDropWith coordinator: UITableViewDropCoordinator) {
    guard let item = coordinator.items.first, let id = item.dragItem.localObject as? String,
      let destination = coordinator.destinationIndexPath, !rows.isEmpty else { return }
    let index = min(destination.row, rows.count - 1)
    move(id: id, to: index)
    coordinator.drop(item.dragItem, toRowAt: IndexPath(row: index, section: 0))
  }
}
