package com.projectteamforyou.autoflow.triggers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.input.InputManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import android.view.InputDevice
import androidx.core.content.ContextCompat

/**
 * Device-event triggers. Android 8+ no longer delivers most implicit broadcasts to manifest receivers, so these are
 * registered at runtime while the process lives (it lives while the accessibility service is enabled), and only while
 * at least one deviceEvent trigger exists. No extra permissions: Wi-Fi via NetworkCallback (ACCESS_NETWORK_STATE),
 * Bluetooth/wired headsets via AudioDeviceCallback (no Bluetooth permission), keyboards/mice/gamepads via
 * InputManager. bootCompleted comes from [BootReceiver].
 */
object DeviceEventMonitor {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var active = false
    private var power: BroadcastReceiver? = null
    private var net: ConnectivityManager.NetworkCallback? = null
    private var audio: AudioDeviceCallback? = null
    private var input: InputManager.InputDeviceListener? = null

    private val BT_TYPES = setOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, 26 /* BLE_HEADSET */, 27 /* BLE_SPEAKER */)
    private val WIRED_TYPES = setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET)

    @Synchronized
    fun reconcile(context: Context, needed: Boolean) {
        val app = context.applicationContext
        if (needed && !active) start(app) else if (!needed && active) stop(app)
    }

    private fun fire(context: Context, event: String) = TriggerEngine.onDeviceEvent(context, event)

    private fun start(context: Context) {
        active = true
        power = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                when (i.action) {
                    Intent.ACTION_POWER_CONNECTED -> fire(context, "charging")
                    Intent.ACTION_BATTERY_LOW -> fire(context, "batteryLow")
                }
            }
        }.also {
            ContextCompat.registerReceiver(
                context, it, IntentFilter().apply { addAction(Intent.ACTION_POWER_CONNECTED); addAction(Intent.ACTION_BATTERY_LOW) },
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        }

        val cm = context.getSystemService(ConnectivityManager::class.java)
        net = object : ConnectivityManager.NetworkCallback() {
            private val up = HashSet<Network>()
            override fun onAvailable(network: Network) {
                synchronized(up) { if (up.add(network) && up.size == 1) fire(context, "wifiConnected") }
            }
            override fun onLost(network: Network) {
                synchronized(up) { if (up.remove(network) && up.isEmpty()) fire(context, "wifiDisconnected") }
            }
        }.also {
            cm?.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), it)
        }

        val am = context.getSystemService(AudioManager::class.java)
        audio = object : AudioDeviceCallback() {
            private var primed = false
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
                // The first callback lists devices already connected at registration: not an event.
                if (!primed) {
                    primed = true
                    return
                }
                if (added.any { it.isSink && it.type in BT_TYPES }) fire(context, "bluetoothConnected")
                if (added.any { it.type in WIRED_TYPES }) fire(context, "headsetPlugged")
            }
        }.also { am?.registerAudioDeviceCallback(it, main) }

        val im = context.getSystemService(InputManager::class.java)
        input = object : InputManager.InputDeviceListener {
            override fun onInputDeviceAdded(deviceId: Int) {
                val d = InputDevice.getDevice(deviceId) ?: return
                if (!d.isVirtual && externalDevice(d)) fire(context, "deviceConnected")
            }
            override fun onInputDeviceRemoved(deviceId: Int) = fire(context, "deviceDisconnected")
            override fun onInputDeviceChanged(deviceId: Int) = Unit
        }.also { im?.registerInputDeviceListener(it, main) }
    }

    private fun externalDevice(d: InputDevice): Boolean = if (android.os.Build.VERSION.SDK_INT >= 29) d.isExternal else true

    private fun stop(context: Context) {
        active = false
        power?.let { runCatching { context.unregisterReceiver(it) } }
        net?.let { cb -> runCatching { context.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) } }
        audio?.let { cb -> context.getSystemService(AudioManager::class.java)?.unregisterAudioDeviceCallback(cb) }
        input?.let { l -> context.getSystemService(InputManager::class.java)?.unregisterInputDeviceListener(l) }
        power = null; net = null; audio = null; input = null
    }
}
