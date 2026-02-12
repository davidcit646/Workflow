package com.workflow.tracker

import android.app.Activity
import com.getcapacitor.*
import com.android.billingclient.api.*

@CapacitorPlugin(name = "WorkflowBilling")
class WorkflowBillingPlugin : Plugin(), PurchasesUpdatedListener {
  private var billingClient: BillingClient? = null
  private var pendingCall: PluginCall? = null

  @PluginMethod
  fun purchase(call: PluginCall) {
    val sku = call.getString("sku")
    if (sku.isNullOrBlank()) {
      call.reject("Missing sku")
      return
    }

    if (pendingCall != null) {
      call.reject("Another purchase is already in progress.")
      return
    }

    pendingCall = call
    ensureClient(call) {
      queryProductAndLaunch(sku, call)
    }
  }

  private fun ensureClient(call: PluginCall, onReady: () -> Unit) {
    val client = billingClient ?: BillingClient.newBuilder(context)
      .setListener(this)
      .enablePendingPurchases()
      .build()
      .also { billingClient = it }

    if (client.isReady) {
      onReady()
      return
    }

    client.startConnection(object : BillingClientStateListener {
      override fun onBillingServiceDisconnected() {
        pendingCall?.reject("Billing service disconnected.")
        pendingCall = null
      }

      override fun onBillingSetupFinished(result: BillingResult) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
          onReady()
          return
        }
        pendingCall?.reject("Billing unavailable: ${result.debugMessage}")
        pendingCall = null
      }
    })
  }

  private fun queryProductAndLaunch(sku: String, call: PluginCall) {
    val product = QueryProductDetailsParams.Product.newBuilder()
      .setProductId(sku)
      .setProductType(BillingClient.ProductType.INAPP)
      .build()

    val params = QueryProductDetailsParams.newBuilder()
      .setProductList(listOf(product))
      .build()

    billingClient?.queryProductDetailsAsync(params) { result, products ->
      if (result.responseCode != BillingClient.BillingResponseCode.OK || products.isEmpty()) {
        call.reject("Unable to load product details.")
        pendingCall = null
        return@queryProductDetailsAsync
      }

      val details = products.first()
      val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
        .setProductDetails(details)
        .build()

      val flowParams = BillingFlowParams.newBuilder()
        .setProductDetailsParamsList(listOf(productParams))
        .build()

      val currentActivity: Activity? = activity
      if (currentActivity == null) {
        call.reject("Unable to launch billing flow.")
        pendingCall = null
        return@queryProductDetailsAsync
      }

      val launch = billingClient?.launchBillingFlow(currentActivity, flowParams)
      if (launch?.responseCode != BillingClient.BillingResponseCode.OK) {
        call.reject("Billing launch failed: ${launch?.debugMessage}")
        pendingCall = null
      }
    }
  }

  override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
    val call = pendingCall ?: return

    when (result.responseCode) {
      BillingClient.BillingResponseCode.OK -> {
        val purchase = purchases?.firstOrNull()
        if (purchase == null) {
          call.reject("No purchase returned.")
          pendingCall = null
          return
        }
        handlePurchase(call, purchase)
      }
      BillingClient.BillingResponseCode.USER_CANCELED -> {
        call.reject("Purchase canceled.")
        pendingCall = null
      }
      else -> {
        call.reject("Purchase failed: ${result.debugMessage}")
        pendingCall = null
      }
    }
  }

  private fun handlePurchase(call: PluginCall, purchase: Purchase) {
    if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) {
      call.reject("Purchase not completed.")
      pendingCall = null
      return
    }

    val consumeParams = ConsumeParams.newBuilder()
      .setPurchaseToken(purchase.purchaseToken)
      .build()

    billingClient?.consumeAsync(consumeParams) { result, token ->
      if (result.responseCode == BillingClient.BillingResponseCode.OK) {
        val data = JSObject()
        data.put("ok", true)
        data.put("token", token)
        call.resolve(data)
      } else {
        call.reject("Unable to finalize purchase: ${result.debugMessage}")
      }
      pendingCall = null
    }
  }
}
