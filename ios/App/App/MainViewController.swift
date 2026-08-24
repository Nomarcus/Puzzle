//
//  MainViewController.swift
//  Shiftle
//
//  Exists for one reason: to register the app's own plugin.
//
//  Capacitor does not find plugins by scanning the Objective-C runtime, which
//  is what I assumed when GameConnect was written. It registers exactly what
//  `capacitor.config.json` lists in `packageClassList`, and `cap sync`
//  generates that from the npm packages in package.json. A plugin living in
//  the app target is in no package, so it appears nowhere on that list and is
//  never registered — no plugin header is injected, the JS side correctly
//  reports Game Center as unavailable, and every call is a silent no-op.
//
//  `capacitorDidLoad()` runs immediately after the bridge is built and before
//  the web view loads, so registering here means the header is in place by the
//  time the game asks whether Game Center exists.
//
//  Main.storyboard points at this class rather than CAPBridgeViewController.
//

import Capacitor
import UIKit

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameConnectPlugin())
    }
}
