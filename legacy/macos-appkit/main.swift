import AppKit

// MARK: - Constants

let CLIENT_ID = "2eb25762-877f-4140-b341-7c7e14c19f98"
let CHECKOUT_BASE = "https://checkout.playstation.com/add"
let CATALOG_BASE = "https://store.playstation.com/store/api/chihiro/00_09_000/container"
let REGIONS = ["US", "GB", "DE", "FR", "JP", "PL", "TR", "AU", "CA", "IE", "SE", "ZA", "IT", "ES"]

func col(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255.0,
            green: CGFloat((hex >> 8) & 0xFF) / 255.0,
            blue: CGFloat(hex & 0xFF) / 255.0,
            alpha: 1.0)
}

let cBG = col(0x0E1014)
let cPanel = col(0x171A21)
let cPanelHi = col(0x1E222B)
let cBorder = col(0x2B313C)
let cText = col(0xE7EAF0)
let cMuted = col(0x99A1B0)
let cAccent = col(0x3B74F2)
let cGood = col(0x2FBF87)
let cBad = col(0xE5484D)

// MARK: - Model

struct CardData {
    let name: String
    let platform: String
    let price: String
    let baseSku: String
    let checkoutSku: String
    let link: String
    let imageURL: URL?
    let game: String?
    let region: String
    let source: String
}

enum LookupError: Error {
    case badInput
    case notInArchive(String)
    case notSold(String, String)
    case transport(String)

    var message: String {
        switch self {
        case .badInput:
            return "Paste a 40-character PSNA hash, or a full SKU like UP1004-BLUS30418_00-AVARDRSHADOWWOLF."
        case .notInArchive(let h):
            return "\(h) isn't in the archive index.\nIt covers the 5,415 avatars from the PS3-Avatars-Edat collection."
        case .notSold(let r, _):
            return "Not sold in \(r). Sony returns DataNotFound for this SKU there — delisted, or a different catalog. Try another region."
        case .transport(let m):
            return "Catalog request failed: \(m)"
        }
    }
}

final class Archive {
    static let shared = Archive()
    private(set) var skuByHash: [String: String] = [:]
    private(set) var gameByHash: [String: String] = [:]

    init() {
        guard let url = Bundle.main.url(forResource: "avatar-sku-index", withExtension: "tsv"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        for line in text.split(separator: "\n").dropFirst() {
            let f = line.split(separator: "\t", omittingEmptySubsequences: false)
            guard f.count >= 3 else { continue }
            let hash = String(f[0]).uppercased()
            if !f[1].isEmpty { gameByHash[hash] = String(f[1]) }
            if !f[2].isEmpty { skuByHash[hash] = String(f[2]) }
        }
    }
}

func stripVariant(_ sku: String) -> String {
    guard let dash = sku.lastIndex(of: "-") else { return sku }
    let tail = String(sku[sku.index(after: dash)...])
    if tail.count == 4, let first = tail.first, first.isLetter,
       tail.allSatisfy({ $0.isLetter || $0.isNumber }) {
        return String(sku[..<dash])
    }
    return sku
}

// MARK: - Controller

final class CartApp: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var root: NSView!
    var mainStack: NSStackView!
    var footerLabel: NSTextField!

    let inputField = NSTextField()
    let messageBox = NSView()
    let messageLabel = NSTextField(labelWithString: "")
    let cardBox = NSView()
    var regionButtons: [NSButton] = []

    var region = "US"
    var current: CardData?
    var copied = false
    var imageCache: [String: NSImage] = [:]
    var imageTasks: Set<String> = []

    // MARK: lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 820, height: 572),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PSN Avatar → Cart"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = cBG
        window.minSize = NSSize(width: 720, height: 360)
        window.center()

        root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = cBG.cgColor
        window.contentView = root

        buildUI()
        rebuildCard()
        fitWindow()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(inputField)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Shrink/grow the window so the window is exactly as tall as its content.
    func fitWindow() {
        guard let window, let mainStack, let footerLabel else { return }
        root.layoutSubtreeIfNeeded()
        let needed = mainStack.fittingSize.height + 14 + footerLabel.fittingSize.height + 18 + 22
        let target = max(360, needed)
        let current = root.bounds.height
        guard abs(target - current) > 1 else { return }
        var frame = window.frame
        let delta = target - current
        frame.size.height += delta
        frame.origin.y -= delta
        window.setFrame(frame, display: true)
    }

    // MARK: small builders

    func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular,
               color: NSColor, mono: Bool = false) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = mono ? .monospacedSystemFont(ofSize: size, weight: weight)
                      : .systemFont(ofSize: size, weight: weight)
        l.textColor = color
        l.isSelectable = false
        l.maximumNumberOfLines = 0
        l.lineBreakMode = .byWordWrapping
        return l
    }

    func makeButton(_ title: String, action: Selector, primary: Bool) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.isBordered = false
        b.wantsLayer = true
        b.layer?.cornerRadius = 7
        b.layer?.backgroundColor = (primary ? cAccent : cPanelHi).cgColor
        b.contentTintColor = primary ? .white : cText
        b.font = .systemFont(ofSize: 12, weight: .medium)
        b.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        return b
    }

    func styleRegion(_ b: NSButton, active: Bool) {
        b.wantsLayer = true
        b.layer?.cornerRadius = 6
        b.layer?.backgroundColor = (active ? cAccent : cPanel).cgColor
        b.layer?.borderWidth = 1
        b.layer?.borderColor = (active ? cAccent : cBorder).cgColor
        b.contentTintColor = active ? .white : cMuted
    }

    // MARK: UI

    func buildUI() {
        let stack = NSStackView()
        mainStack = stack
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 22),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -22),
        ])

        // Header
        let title = label("PSN Avatar → Cart", size: 22, weight: .bold, color: cText)
        let subtitle = label("PSNA hash or SKU → live catalog lookup → checkout link",
                             size: 11, color: cMuted)
        let header = NSStackView(views: [title, subtitle])
        header.orientation = .vertical
        header.alignment = .leading
        header.spacing = 3
        stack.addArrangedSubview(header)

        // Region chips — two rows so they cannot clip at the minimum width
        let chipWrap = NSStackView()
        chipWrap.orientation = .vertical
        chipWrap.alignment = .leading
        chipWrap.spacing = 6
        for slice in [Array(REGIONS.prefix(7)), Array(REGIONS.dropFirst(7))] {
            let chipRow = NSStackView()
            chipRow.orientation = .horizontal
            chipRow.spacing = 6
            for code in slice {
                let b = NSButton(title: code, target: self, action: #selector(regionTapped(_:)))
                b.isBordered = false
                b.font = .systemFont(ofSize: 11, weight: .medium)
                b.identifier = NSUserInterfaceItemIdentifier(code)
                styleRegion(b, active: code == region)
                b.translatesAutoresizingMaskIntoConstraints = false
                b.heightAnchor.constraint(equalToConstant: 24).isActive = true
                b.widthAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
                regionButtons.append(b)
                chipRow.addArrangedSubview(b)
            }
            chipWrap.addArrangedSubview(chipRow)
        }
        stack.addArrangedSubview(chipWrap)

        // Input row — the field lives inside a styled box so the text is
        // vertically centred and never clipped by the field's own bounds.
        let fieldBox = NSView()
        fieldBox.wantsLayer = true
        fieldBox.layer?.backgroundColor = cPanel.cgColor
        fieldBox.layer?.cornerRadius = 7
        fieldBox.layer?.borderWidth = 1
        fieldBox.layer?.borderColor = cBorder.cgColor
        fieldBox.translatesAutoresizingMaskIntoConstraints = false
        fieldBox.heightAnchor.constraint(equalToConstant: 40).isActive = true

        inputField.isBordered = false
        inputField.drawsBackground = false
        inputField.focusRingType = .none
        inputField.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        inputField.textColor = cText
        inputField.lineBreakMode = .byTruncatingTail
        inputField.cell?.usesSingleLineMode = true
        inputField.cell?.isScrollable = true
        inputField.placeholderAttributedString = NSAttributedString(
            string: "Paste a PSNA hash or SKU…",
            attributes: [
                .foregroundColor: cMuted,
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
            ]
        )
        inputField.target = self
        inputField.action = #selector(resolveTapped)
        inputField.translatesAutoresizingMaskIntoConstraints = false
        fieldBox.addSubview(inputField)
        NSLayoutConstraint.activate([
            inputField.leadingAnchor.constraint(equalTo: fieldBox.leadingAnchor, constant: 10),
            inputField.trailingAnchor.constraint(equalTo: fieldBox.trailingAnchor, constant: -10),
            inputField.centerYAnchor.constraint(equalTo: fieldBox.centerYAnchor),
            inputField.heightAnchor.constraint(equalToConstant: 24),
        ])

        let pasteBtn = makeButton("Paste", action: #selector(pasteTapped), primary: false)
        pasteBtn.translatesAutoresizingMaskIntoConstraints = false
        pasteBtn.widthAnchor.constraint(equalToConstant: 70).isActive = true
        pasteBtn.heightAnchor.constraint(equalToConstant: 40).isActive = true

        let goBtn = makeButton("Resolve", action: #selector(resolveTapped), primary: true)
        goBtn.translatesAutoresizingMaskIntoConstraints = false
        goBtn.widthAnchor.constraint(equalToConstant: 84).isActive = true
        goBtn.heightAnchor.constraint(equalToConstant: 40).isActive = true

        let inputRow = NSStackView(views: [fieldBox, pasteBtn, goBtn])
        inputRow.orientation = .horizontal
        inputRow.spacing = 8
        inputRow.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(inputRow)
        inputRow.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        fieldBox.setContentHuggingPriority(.defaultLow, for: .horizontal)

        // Message banner
        messageBox.wantsLayer = true
        messageBox.layer?.cornerRadius = 8
        messageBox.layer?.borderWidth = 1
        messageBox.translatesAutoresizingMaskIntoConstraints = false
        messageLabel.translatesAutoresizingMaskIntoConstraints = false
        messageLabel.maximumNumberOfLines = 0
        messageLabel.lineBreakMode = .byWordWrapping
        messageBox.addSubview(messageLabel)
        NSLayoutConstraint.activate([
            messageLabel.topAnchor.constraint(equalTo: messageBox.topAnchor, constant: 9),
            messageLabel.leadingAnchor.constraint(equalTo: messageBox.leadingAnchor, constant: 11),
            messageLabel.trailingAnchor.constraint(equalTo: messageBox.trailingAnchor, constant: -11),
            messageLabel.bottomAnchor.constraint(equalTo: messageBox.bottomAnchor, constant: -9),
        ])
        stack.addArrangedSubview(messageBox)
        messageBox.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        messageBox.isHidden = true

        // Card
        cardBox.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(cardBox)
        cardBox.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true

        // Footer pinned to the bottom of the window
        let footer = label(
            "Nothing is purchased here — the link only puts the item in your cart; you confirm and pay on PlayStation's own checkout page.",
            size: 10, color: cMuted)
        footerLabel = footer
        footer.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(footer)
        NSLayoutConstraint.activate([
            footer.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 22),
            footer.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -22),
            footer.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -18),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: footer.topAnchor, constant: -14),
        ])
    }

    // MARK: messages

    func clearMessage() {
        messageLabel.stringValue = ""
        messageBox.isHidden = true
        fitWindow()
    }

    func showMessage(_ text: String, error: Bool) {
        messageLabel.stringValue = text
        messageLabel.font = .systemFont(ofSize: 11.5)
        messageLabel.textColor = error ? cBad : cMuted
        messageLabel.preferredMaxLayoutWidth = max(100, (window.contentView?.bounds.width ?? 800) - 66)
        messageBox.layer?.backgroundColor = (error ? cBad.withAlphaComponent(0.10) : cPanel).cgColor
        messageBox.layer?.borderColor = (error ? cBad.withAlphaComponent(0.45) : cBorder).cgColor
        messageBox.isHidden = false
    }

    // MARK: raw lookup

    static func fetchCatalog(base: String, region: String) throws -> Data {
        guard let url = URL(string: "\(CATALOG_BASE)/\(region)/en/19/\(base)/") else {
            throw LookupError.badInput
        }
        var request = URLRequest(url: url)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                         forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 20

        let semaphore = DispatchSemaphore(value: 0)
        var payload: Data?
        var status = 0
        var failure: Error?

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { failure = error }
            payload = data
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
            semaphore.signal()
        }.resume()
        semaphore.wait()

        if let failure { throw LookupError.transport(failure.localizedDescription) }
        if status == 404 { throw LookupError.notSold(region, base) }
        guard let payload, status == 200 else {
            throw LookupError.transport("HTTP \(status)")
        }
        return payload
    }

    /// Probe every other tracked store to see where this SKU is still on sale.
    static func liveRegions(base: String, excluding: String) -> [String] {
        var found = Set<String>()
        let lock = NSLock()
        let group = DispatchGroup()
        for cc in REGIONS where cc != excluding {
            group.enter()
            DispatchQueue.global().async {
                if (try? fetchCatalog(base: base, region: cc)) != nil {
                    lock.lock(); found.insert(cc); lock.unlock()
                }
                group.leave()
            }
        }
        group.wait()
        return REGIONS.filter { found.contains($0) }
    }

    static func lookup(rawInput: String, region: String) throws -> CardData {
        let cleaned = rawInput
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
            .replacingOccurrences(of: "PSNA_", with: "")
            .replacingOccurrences(of: ".EDAT", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var sku: String
        var source: String
        var game: String?

        if cleaned.count == 40 && cleaned.allSatisfy({ $0.isHexDigit }) {
            guard let found = Archive.shared.skuByHash[cleaned] else {
                throw LookupError.notInArchive(cleaned)
            }
            sku = found
            game = Archive.shared.gameByHash[cleaned]
            source = "PSNA hash → SKU"
        } else if cleaned.contains("-") && cleaned.contains("_") {
            sku = cleaned
            source = "Direct SKU lookup"
        } else {
            throw LookupError.badInput
        }

        let base = stripVariant(sku)
        let payload = try fetchCatalog(base: base, region: region)
        guard let obj = try JSONSerialization.jsonObject(with: payload) as? [String: Any] else {
            throw LookupError.transport("unparseable catalog JSON")
        }

        let name = obj["name"] as? String ?? "(unnamed)"
        let platform = (obj["playable_platform"] as? [String])?.first ?? "?"
        let skuObj = obj["default_sku"] as? [String: Any] ?? [:]
        let price = skuObj["display_price"] as? String ?? "—"
        let checkoutSku = skuObj["id"] as? String ?? base

        var imageURL: URL?
        if let images = obj["images"] as? [[String: Any]],
           let last = images.last,
           let s = last["url"] as? String {
            imageURL = URL(string: s)
        }

        return CardData(
            name: name, platform: platform, price: price, baseSku: base,
            checkoutSku: checkoutSku,
            link: "\(CHECKOUT_BASE)/\(checkoutSku)?clientId=\(CLIENT_ID)",
            imageURL: imageURL, game: game, region: region, source: source
        )
    }

    // MARK: actions

    @objc func regionTapped(_ sender: NSButton) {
        guard let code = sender.identifier?.rawValue else { return }
        region = code
        for b in regionButtons { styleRegion(b, active: b.identifier?.rawValue == code) }
        current = nil
        clearMessage()
        rebuildCard()
        if !inputField.stringValue.trimmingCharacters(in: .whitespaces).isEmpty {
            resolve()
        }
    }

    @objc func pasteTapped() {
        if let s = NSPasteboard.general.string(forType: .string) {
            inputField.stringValue = s.trimmingCharacters(in: .whitespacesAndNewlines)
            copied = false
        }
    }

    @objc func resolveTapped() { resolve() }

    func resolve() {
        let raw = inputField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        showMessage("Querying the PlayStation catalog…", error: false)
        current = nil
        rebuildCard()

        let regionNow = region
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let card = try Self.lookup(rawInput: raw, region: regionNow)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.current = card
                    self.clearMessage()
                    self.rebuildCard()
                }
            } catch let err as LookupError {
                var text = err.message
                if case .notSold(let r, let base) = err {
                    DispatchQueue.main.async { [weak self] in
                        self?.showMessage("Not sold in \(r) — checking the other \(REGIONS.count - 1) stores…", error: false)
                    }
                    let others = Self.liveRegions(base: base, excluding: r)
                    if others.isEmpty {
                        text = "Not sold in \(r) — and not in any of the other \(REGIONS.count - 1) tracked stores either. This SKU is delisted as far as I can check."
                    } else {
                        text = "Not sold in \(r). Still on sale in: \(others.joined(separator: ", ")). Switch the region chip to one of those."
                    }
                }
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.showMessage(text, error: true)
                }
            } catch {
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.showMessage("Lookup failed: \(error.localizedDescription)", error: true)
                }
            }
        }
    }

    // MARK: images

    func image(for url: URL) -> NSImage? {
        let key = url.absoluteString
        if let cached = imageCache[key] { return cached }
        if !imageTasks.contains(key) {
            imageTasks.insert(key)
            let target = url
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let data = try? Data(contentsOf: target)
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.imageTasks.remove(key)
                    if let data, let img = NSImage(data: data) {
                        self.imageCache[key] = img
                        if self.current?.imageURL?.absoluteString == key {
                            self.rebuildCard()
                        }
                    }
                }
            }
        }
        return nil
    }

    // MARK: card

    func rebuildCard() {
        cardBox.subviews.forEach { $0.removeFromSuperview() }

        guard let card = current else {
            let empty = emptyState()
            empty.translatesAutoresizingMaskIntoConstraints = false
            cardBox.addSubview(empty)
            NSLayoutConstraint.activate([
                empty.topAnchor.constraint(equalTo: cardBox.topAnchor),
                empty.leadingAnchor.constraint(equalTo: cardBox.leadingAnchor),
                empty.trailingAnchor.constraint(equalTo: cardBox.trailingAnchor),
                empty.bottomAnchor.constraint(equalTo: cardBox.bottomAnchor),
                empty.heightAnchor.constraint(equalToConstant: 124),
            ])
            fitWindow()
            return
        }

        let panel = NSView()
        panel.wantsLayer = true
        panel.layer?.backgroundColor = cPanel.cgColor
        panel.layer?.cornerRadius = 10
        panel.layer?.borderWidth = 1
        panel.layer?.borderColor = cBorder.cgColor
        panel.translatesAutoresizingMaskIntoConstraints = false

        let thumb = NSImageView()
        thumb.wantsLayer = true
        thumb.layer?.cornerRadius = 8
        thumb.layer?.masksToBounds = true
        thumb.layer?.backgroundColor = cPanelHi.cgColor
        thumb.imageScaling = .scaleProportionallyUpOrDown
        thumb.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            thumb.widthAnchor.constraint(equalToConstant: 128),
            thumb.heightAnchor.constraint(equalToConstant: 128),
        ])
        if let imageURL = card.imageURL {
            thumb.image = image(for: imageURL)
        }

        let nameLabel = label(card.name, size: 16, weight: .bold, color: cText)
        let platformLabel = label("\(card.platform) · \(card.region)", size: 11, color: cMuted)
        let priceLabel = label(card.price, size: 14, weight: .semibold,
                               color: card.price == "Free" ? cGood : cText)
        let skuLabel = label(card.baseSku, size: 10, color: cMuted, mono: true)
        let metaText = card.game.map { "\($0) · \(card.source)" } ?? card.source
        let metaLabel = label(metaText, size: 10, color: cMuted)

        let textStack = NSStackView(views: [nameLabel, platformLabel, priceLabel, skuLabel, metaLabel])
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 4

        let topRow = NSStackView(views: [thumb, textStack])
        topRow.orientation = .horizontal
        topRow.alignment = .top
        topRow.spacing = 14

        let addBtn = makeButton("Add to cart ↗", action: #selector(addToCart), primary: true)
        addBtn.translatesAutoresizingMaskIntoConstraints = false
        addBtn.heightAnchor.constraint(equalToConstant: 32).isActive = true
        addBtn.widthAnchor.constraint(equalToConstant: 124).isActive = true

        let copyBtn = makeButton(copied ? "Copied ✓" : "Copy link",
                                 action: #selector(copyLink), primary: false)
        copyBtn.translatesAutoresizingMaskIntoConstraints = false
        copyBtn.heightAnchor.constraint(equalToConstant: 32).isActive = true
        copyBtn.widthAnchor.constraint(equalToConstant: 100).isActive = true

        let hint = label("Opens in your default browser with your existing store session.",
                         size: 10, color: cMuted)

        let actionRow = NSStackView(views: [addBtn, copyBtn, hint])
        actionRow.orientation = .horizontal
        actionRow.spacing = 8
        actionRow.alignment = .centerY

        let content = NSStackView(views: [topRow, actionRow])
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 12
        content.translatesAutoresizingMaskIntoConstraints = false

        panel.addSubview(content)
        cardBox.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.topAnchor.constraint(equalTo: cardBox.topAnchor),
            panel.leadingAnchor.constraint(equalTo: cardBox.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: cardBox.trailingAnchor),
            panel.bottomAnchor.constraint(equalTo: cardBox.bottomAnchor),

            content.topAnchor.constraint(equalTo: panel.topAnchor, constant: 14),
            content.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 14),
            content.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -14),
            content.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -14),
        ])
        fitWindow()
    }

    func emptyState() -> NSView {
        let box = NSView()
        box.wantsLayer = true
        box.layer?.backgroundColor = cPanel.withAlphaComponent(0.55).cgColor
        box.layer?.cornerRadius = 10
        box.layer?.borderWidth = 1
        box.layer?.borderColor = cBorder.cgColor

        let title = label("No item resolved yet", size: 13, weight: .semibold, color: cMuted)
        let body = label("Pick a region, paste a PSNA hash or SKU, then hit Resolve.\nArtwork, price and a ready-to-use cart link appear here.",
                         size: 11, color: cMuted)
        let stack = NSStackView(views: [title, body])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: box.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: box.trailingAnchor, constant: -16),
        ])
        return box
    }

    @objc func addToCart() {
        guard let card = current, let url = URL(string: card.link) else { return }
        NSWorkspace.shared.open(url)
        copied = false
    }

    @objc func copyLink() {
        guard let card = current else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(card.link, forType: .string)
        copied = true
        rebuildCard()
    }
}

// MARK: - Headless self-test

if CommandLine.arguments.contains("--selftest") {
    let cases = [
        ("B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB", "GB"),
        ("UP1004-BLUS30418_00-AVARDRSHADOWWOLF-UA01", "US"),
        ("34A89865194D192300B7C29FD43222B86EA1B99B", "GB"),
        ("DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF", "US"),
        ("0300F206172D2DE79C5479547C7B13DF6CD0E693", "US"),
    ]
    for (raw, reg) in cases {
        do {
            let c = try CartApp.lookup(rawInput: raw, region: reg)
            print("OK   [\(reg)] \(c.name) | \(c.price) | \(c.link)")
        } catch let e as LookupError {
            if case .notSold(let r, let base) = e {
                let others = CartApp.liveRegions(base: base, excluding: r)
                print("FAIL [\(reg)] \(raw.prefix(12))… -> not sold in \(r); live in: \(others.isEmpty ? "nowhere" : others.joined(separator: ","))")
            } else {
                print("FAIL [\(reg)] \(raw.prefix(12))… -> \(e.message)")
            }
        } catch {
            print("FAIL \(error)")
        }
    }
    exit(0)
}

// MARK: - Offscreen snapshot (layout verification)

if let idx = CommandLine.arguments.firstIndex(of: "--snapshot") {
    let out = CommandLine.arguments[idx + 1]
    let state = CommandLine.arguments.count > idx + 2 ? CommandLine.arguments[idx + 2] : "card"
    let app = CartApp()
    app.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))

    if state == "error" {
        app.showMessage(LookupError.notSold("US", "-").message, error: true)
    } else if state == "sweep" {
        let others = CartApp.liveRegions(base: "EP1004-BLES01179_00-AVREDDEADR000004", excluding: "US")
        app.showMessage("Not sold in US. Still on sale in: \(others.joined(separator: ", ")). Switch the region chip to one of those.", error: true)
    } else if state != "empty" {
        let (raw, reg) = state == "gb"
            ? ("B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB", "GB")
            : ("UP1004-BLUS30418_00-AVARDRSHADOWWOLF", "US")
        app.region = reg
        for b in app.regionButtons { app.styleRegion(b, active: b.identifier?.rawValue == reg) }
        app.inputField.stringValue = raw
        if let card = try? CartApp.lookup(rawInput: raw, region: reg) {
            app.current = card
            if let url = card.imageURL, let data = try? Data(contentsOf: url) {
                app.imageCache[url.absoluteString] = NSImage(data: data)
            }
        }
    }

    app.rebuildCard()
    let view = app.window.contentView!
    view.layoutSubtreeIfNeeded()
    view.displayIfNeeded()
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(2) }
    view.cacheDisplay(in: view.bounds, to: rep)
    guard let png = rep.representation(using: .png, properties: [:]) else { exit(3) }
    try? png.write(to: URL(fileURLWithPath: out))
    print("wrote \(out)")
    exit(0)
}

// MARK: - Boot

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = CartApp()
app.delegate = delegate
app.run()
