//
//  GameConnect.swift
//  Shiftle
//
//  Game Center, as a Capacitor plugin living in the app rather than a
//  dependency. Nothing on npm does this well enough to be worth the supply
//  chain — it is about a hundred lines of GameKit, and owning it means the
//  build never breaks because somebody else's plugin stopped being maintained.
//
//  Capacitor finds this class through the Objective-C runtime, so there is no
//  registration step. The web side (src/platform/gamecenter.ts) resolves it off
//  Capacitor.Plugins.GameConnect and no-ops when it is not there, which is what
//  keeps the browser build running.
//

import Capacitor
import Foundation
import GameKit

@objc(GameConnectPlugin)
public class GameConnectPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameConnectPlugin"
    public let jsName = "GameConnect"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAuthenticated", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
    ]

    /// GameKit calls the authenticate handler again whenever the player signs
    /// in or out, so it is installed once and the result is remembered.
    private var authenticationStarted = false

    // MARK: - Authentication

    /// Safe to call on every launch. GameKit itself decides whether to prompt,
    /// and only ever does so once per install.
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if GKLocalPlayer.local.isAuthenticated {
                call.resolve(["authenticated": true])
                return
            }

            if self.authenticationStarted {
                // A handler is already installed and still working. Answering
                // with the current state beats leaving the promise hanging.
                call.resolve(["authenticated": GKLocalPlayer.local.isAuthenticated])
                return
            }
            self.authenticationStarted = true

            // Resolved at most once: the handler fires again on every later
            // sign-in and sign-out, and a second resolve would be a crash.
            var settled = false
            let settle = { (authenticated: Bool) in
                guard !settled else { return }
                settled = true
                call.resolve(["authenticated": authenticated])
            }

            GKLocalPlayer.local.authenticateHandler = { viewController, _ in
                if let viewController = viewController {
                    // Game Center wants to show its own sign-in sheet. Handing
                    // it the bridge's controller is the whole integration.
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                settle(GKLocalPlayer.local.isAuthenticated)
            }
        }
    }

    @objc func isAuthenticated(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["authenticated": GKLocalPlayer.local.isAuthenticated])
        }
    }

    // MARK: - Scores

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let leaderboardID = call.getString("leaderboardID") else {
            call.reject("leaderboardID is required")
            return
        }
        // Never negative: Game Center rejects that, and the score is a count.
        let score = max(0, call.getInt("totalScoreAmount") ?? 0)

        // Capacitor calls plugin methods off the main queue; the local player's
        // state is read on it.
        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated else {
                // Not an error worth surfacing: plenty of players never sign
                // in, and the round they just finished still counts locally.
                call.resolve(["submitted": false, "reason": "not-authenticated"])
                return
            }

            GKLeaderboard.submitScore(
                score,
                context: 0,
                player: GKLocalPlayer.local,
                leaderboardIDs: [leaderboardID]
            ) { error in
                if let error = error {
                    call.resolve(["submitted": false, "reason": error.localizedDescription])
                    return
                }
                call.resolve(["submitted": true])
            }
        }
    }

    // MARK: - The overlay

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        let leaderboardID = call.getString("leaderboardID")

        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated else {
                call.resolve(["shown": false, "reason": "not-authenticated"])
                return
            }
            guard let host = self.bridge?.viewController else {
                call.resolve(["shown": false, "reason": "no-view-controller"])
                return
            }

            let controller: GKGameCenterViewController
            if let leaderboardID = leaderboardID {
                controller = GKGameCenterViewController(
                    leaderboardID: leaderboardID,
                    playerScope: .global,
                    timeScope: .allTime
                )
            } else {
                controller = GKGameCenterViewController(state: .leaderboards)
            }

            controller.gameCenterDelegate = self
            host.present(controller, animated: true)
            call.resolve(["shown": true])
        }
    }
}

extension GameConnectPlugin: GKGameCenterControllerDelegate {
    public func gameCenterViewControllerDidFinish(_ controller: GKGameCenterViewController) {
        controller.dismiss(animated: true)
    }
}
