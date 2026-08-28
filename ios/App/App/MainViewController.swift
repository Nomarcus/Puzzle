//
//  MainViewController.swift
//  Shiftle
//
//  Registers the app-owned Game Center Capacitor plugin.
//

import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    // Keep a strong reference for the entire lifetime of the bridge controller.
    // registerPluginInstance normally retains registered plugins as well, but
    // owning it here removes any ambiguity in signed/release builds.
    private let gameConnectPlugin = GameConnectPlugin()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        print("[Shiftle/GameConnect] capacitorDidLoad START")
        print("[Shiftle/GameConnect] registering jsName=\(gameConnectPlugin.jsName) identifier=\(gameConnectPlugin.identifier)")

        bridge?.registerPluginInstance(gameConnectPlugin)

        if bridge?.plugin(withName: "GameConnect") != nil {
            print("[Shiftle/GameConnect] REGISTERED OK")
        } else {
            print("[Shiftle/GameConnect] REGISTRATION FAILED")
        }
    }
}
