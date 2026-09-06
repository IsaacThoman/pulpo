import ExpoModulesCore
import UIKit

struct QueuedMessageRow: Record {
  @Field var id: String = ""
  @Field var kind: String = ""
  @Field var canRetry: Bool = false
  @Field var content: String = ""
  @Field var detail: String = ""
  @Field var status: String = ""
  @Field var isEditing: Bool = false
  @Field var canEdit: Bool = false
  @Field var canDelete: Bool = false
  @Field var canReorder: Bool = false
}

// Draw separators above entries so the queue never has a trailing row divider.
private final class QueuedMessageCell: UITableViewCell {
  private let separator = UIView()
  var showsSeparator = false { didSet { separator.isHidden = !showsSeparator } }

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    separator.backgroundColor = .separator
    separator.isUserInteractionEnabled = false
    addSubview(separator)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    separator.frame = CGRect(x: 5, y: 0, width: max(0, bounds.width - 10), height: 1 / traitCollection.displayScale)
    bringSubviewToFront(separator)
  }
}

/// UIKit supplies the long-press lift, insertion preview, autoscroll and drop animation.
public final class QueuedMessagesView: ExpoView, UITableViewDataSource, UITableViewDelegate, UITableViewDragDelegate, UITableViewDropDelegate {
  let onAction = EventDispatcher()
  let onContentHeightChange = EventDispatcher()
  private var contentSizeObservation: NSKeyValueObservation?
  private var reportedHeight: CGFloat = -1
  private let table = UITableView(frame: .zero, style: .plain)
  private var rows: [QueuedMessageRow] = []

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    table.backgroundColor = .clear
    table.separatorStyle = .none
    table.tableFooterView = UIView()
    table.showsVerticalScrollIndicator = true
    table.dataSource = self
    table.delegate = self
    table.dragDelegate = self
    table.dropDelegate = self
    table.dragInteractionEnabled = true
    table.rowHeight = UITableView.automaticDimension
    table.estimatedRowHeight = 56
    table.contentInsetAdjustmentBehavior = .never
    table.register(QueuedMessageCell.self, forCellReuseIdentifier: "queue")
    addSubview(table)
    contentSizeObservation = table.observe(\.contentSize, options: [.new]) { [weak self] _, _ in
      self?.reportContentHeight()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    table.frame = bounds
    table.layoutIfNeeded()
    reportContentHeight()
  }

  private func reportContentHeight() {
    guard table.bounds.width > 0 else { return }
    let height = ceil(table.contentSize.height)
    guard height != reportedHeight else { return }
    reportedHeight = height
    DispatchQueue.main.async { [weak self] in
      self?.onContentHeightChange(["height": height])
    }
  }

  func setRows(_ value: [QueuedMessageRow]) {
    rows = value
    table.reloadData()
  }

  public func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

  public func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = rows[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "queue", for: indexPath)
    (cell as? QueuedMessageCell)?.showsSeparator = indexPath.row > 0
    cell.selectionStyle = .none
    cell.backgroundColor = .clear
    cell.contentView.subviews.forEach { $0.removeFromSuperview() }
    let card = UIView()
    card.backgroundColor = row.status == "failed" ? UIColor.systemRed.withAlphaComponent(0.06)
      : row.isEditing ? UIColor.tertiarySystemFill : .clear
    card.layer.cornerRadius = 8
    card.translatesAutoresizingMaskIntoConstraints = false
    cell.contentView.addSubview(card)
    let text = UILabel()
    text.font = .preferredFont(forTextStyle: .subheadline)
    text.textColor = row.isEditing ? .secondaryLabel : .label
    text.adjustsFontForContentSizeCategory = true
    text.numberOfLines = row.kind == "shelf" ? 2 : 0
    text.text = row.content
    let detail = UILabel()
    detail.font = .preferredFont(forTextStyle: .caption1)
    detail.textColor = row.status == "failed" ? .systemRed : .secondaryLabel
    detail.adjustsFontForContentSizeCategory = true
    detail.numberOfLines = 0
    detail.text = row.detail
    detail.isHidden = row.detail.isEmpty
    let labels = UIStackView(arrangedSubviews: [text, detail])
    labels.axis = .vertical
    labels.spacing = 2
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
    var actions = [("delete", "trash", row.canDelete), ("edit", row.kind == "shelf" ? "arrow.uturn.backward" : row.isEditing ? "xmark" : "pencil", row.canEdit)]
    if row.canRetry { actions.insert(("retry", "arrow.clockwise", true), at: 0) }
    for (action, symbol, enabled) in actions {
      let button = UIButton(type: .system)
      button.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 14, weight: .regular)), for: .normal)
      button.tintColor = .secondaryLabel
      button.isEnabled = enabled
      button.accessibilityLabel = action == "edit" && row.isEditing ? "Cancel queued message edit" : "\(action.capitalized) queued message \(indexPath.row + 1)"
      if row.kind == "shelf" { button.accessibilityLabel = action == "edit" ? "Restore draft" : action == "retry" ? "Retry saving draft" : "Delete shelved draft" }
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
      card.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 0),
      card.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: 0),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 5),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 4),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -4),
    ])
    return cell
  }

  public func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
    (cell as? QueuedMessageCell)?.showsSeparator = indexPath.row > 0
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
    for cell in table.visibleCells {
      if let indexPath = table.indexPath(for: cell) {
        (cell as? QueuedMessageCell)?.showsSeparator = indexPath.row > 0
      }
    }
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
