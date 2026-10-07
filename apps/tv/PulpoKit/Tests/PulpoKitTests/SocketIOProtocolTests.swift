import Foundation
import Testing
@testable import PulpoKit

@Suite("Socket.IO framing")
struct SocketIOProtocolTests {
    @Test func parsesTheEngineHandshake() throws {
        let packet = try #require(EnginePacket(text: #"0{"sid":"abc","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":4100000}"#))
        #expect(packet == .open(.init(sid: "abc", pingInterval: 25_000, pingTimeout: 20_000)))
    }

    @Test func parsesHeartbeats() {
        #expect(EnginePacket(text: "2") == .ping)
        #expect(EnginePacket(text: "3") == .pong)
        #expect(EnginePacket.pong.text == "3")
        #expect(EnginePacket(text: "1") == .close)
        #expect(EnginePacket(text: "") == nil)
        #expect(EnginePacket(text: "9") == nil)
    }

    @Test func encodesTheAuthenticatedConnect() throws {
        let text = EnginePacket.message(.connect(auth: ["sessionToken": "t"])).text
        #expect(text == #"40{"sessionToken":"t"}"#)
    }

    @Test func parsesConnectAcknowledgementAndErrors() throws {
        let connected = try #require(EnginePacket(text: #"40{"sid":"x"}"#))
        guard case .message(let packet) = connected else { Issue.record("not a message"); return }
        #expect(packet.kind == .connect)
        #expect(packet.payload?["sid"] == "x")

        let failure = try #require(EnginePacket(text: #"44{"message":"unauthorized"}"#))
        guard case .message(let error) = failure else { Issue.record("not a message"); return }
        #expect(error.kind == .connectError)
        #expect(error.payload?["message"] == "unauthorized")
    }

    @Test func parsesEvents() throws {
        let raw = #"42["response.event",{"responseId":"r","sequence":3,"type":"response.output_text.delta","payload":{"delta":"Hi"},"emittedAt":"2026-10-06T21:00:46.251Z"}]"#
        guard case .message(let packet) = try #require(EnginePacket(text: raw)) else { Issue.record("not a message"); return }
        let (name, argument) = try #require(packet.event)
        #expect(name == "response.event")
        let event = try #require(SocketIOClient.decode(ResponseEvent.self, argument))
        #expect(event.sequence == 3)
        #expect(event.payload["delta"] == "Hi")
    }

    @Test func roundTripsEventsWithAckIdsAndNamespaces() throws {
        let packet = try #require(SocketPacket(text: #"2/admin,12["client.sync",{"a":1}]"#))
        #expect(packet.kind == .event)
        #expect(packet.namespace == "/admin")
        #expect(packet.ackId == 12)
        #expect(packet.event?.name == "client.sync")
        #expect(SocketPacket(text: packet.text) == packet)
    }

    @Test func encodesSubscriptions() throws {
        let text = EnginePacket.message(.event("response.subscribe", ["afterSequence": 4, "responseId": "abc"])).text
        #expect(text.hasPrefix(#"42["response.subscribe",{"#))
        guard case .message(let packet) = try #require(EnginePacket(text: text)) else { Issue.record("not a message"); return }
        #expect(packet.event?.argument["afterSequence"] == 4)
    }

    @Test func rejectsMalformedPayloads() {
        #expect(SocketPacket(text: "2[not json") == nil)
        #expect(SocketPacket(text: "x") == nil)
    }

    @Test func buildsTheWebSocketURL() throws {
        #expect(SocketIOClient.socketURL(for: .production).absoluteString == "wss://pulpo.baby/socket.io/?EIO=4&transport=websocket")
        let local = try ServerAddress("http://localhost:8090", allowLocalHTTP: true)
        #expect(SocketIOClient.socketURL(for: local).absoluteString == "ws://localhost:8090/socket.io/?EIO=4&transport=websocket")
        let prefixed = try ServerAddress("https://example.com/pulpo")
        #expect(SocketIOClient.socketURL(for: prefixed).absoluteString == "wss://example.com/socket.io/?EIO=4&transport=websocket")
        let ipv6 = try ServerAddress("https://[2001:db8::1]:8443")
        #expect(SocketIOClient.socketURL(for: ipv6).absoluteString == "wss://[2001:db8::1]:8443/socket.io/?EIO=4&transport=websocket")
    }
}
