package com.workflow.tracker;

import android.app.Activity;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "WorkflowBilling")
public class WorkflowBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private BillingClient billingClient;
    private PluginCall pendingCall;

    @PluginMethod
    public void purchase(PluginCall call) {
        String sku = call.getString("sku");
        if (sku == null || sku.trim().isEmpty()) {
            call.reject("Missing sku");
            return;
        }

        if (pendingCall != null) {
            call.reject("Another purchase is already in progress.");
            return;
        }

        pendingCall = call;
        String safeSku = sku.trim();
        ensureClient(() -> queryProductAndLaunch(safeSku));
    }

    private void ensureClient(Runnable onReady) {
        BillingClient client = billingClient;
        if (client == null) {
            client = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases()
                .build();
            billingClient = client;
        }

        if (client.isReady()) {
            onReady.run();
            return;
        }

        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingServiceDisconnected() {
                rejectPending("Billing service disconnected.");
            }

            @Override
            public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    onReady.run();
                    return;
                }
                rejectPending("Billing unavailable: " + result.getDebugMessage());
            }
        });
    }

    private void queryProductAndLaunch(String sku) {
        BillingClient client = billingClient;
        if (client == null) {
            rejectPending("Billing unavailable.");
            return;
        }

        QueryProductDetailsParams.Product product =
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(sku)
                .setProductType(BillingClient.ProductType.INAPP)
                .build();

        QueryProductDetailsParams params =
            QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();

        client.queryProductDetailsAsync(params, (result, products) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK
                || products == null
                || products.isEmpty()) {
                rejectPending("Unable to load product details.");
                return;
            }

            ProductDetails details = products.get(0);
            BillingFlowParams.ProductDetailsParams productParams =
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details)
                    .build();

            BillingFlowParams flowParams =
                BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(productParams))
                    .build();

            Activity currentActivity = getActivity();
            if (currentActivity == null) {
                rejectPending("Unable to launch billing flow.");
                return;
            }

            BillingResult launch = client.launchBillingFlow(currentActivity, flowParams);
            if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                rejectPending("Billing launch failed: " + launch.getDebugMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (billingClient != null) {
            billingClient.endConnection();
            billingClient = null;
        }
        pendingCall = null;
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        PluginCall call = pendingCall;
        if (call == null) return;

        int responseCode = result.getResponseCode();
        if (responseCode == BillingClient.BillingResponseCode.OK) {
            Purchase purchase = purchases != null && !purchases.isEmpty() ? purchases.get(0) : null;
            if (purchase == null) {
                rejectPending("No purchase returned.");
                return;
            }
            handlePurchase(purchase);
            return;
        }

        if (responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
            rejectPending("Purchase canceled.");
            return;
        }

        rejectPending("Purchase failed: " + result.getDebugMessage());
    }

    private void handlePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            rejectPending("Purchase not completed.");
            return;
        }

        BillingClient client = billingClient;
        if (client == null) {
            rejectPending("Billing unavailable.");
            return;
        }

        ConsumeParams consumeParams =
            ConsumeParams.newBuilder()
                .setPurchaseToken(purchase.getPurchaseToken())
                .build();

        client.consumeAsync(consumeParams, (result, token) -> {
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                JSObject data = new JSObject();
                data.put("ok", true);
                data.put("token", token);
                resolvePending(data);
                return;
            }
            rejectPending("Unable to finalize purchase: " + result.getDebugMessage());
        });
    }

    private void rejectPending(String message) {
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call != null) call.reject(message);
    }

    private void resolvePending(JSObject data) {
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call != null) call.resolve(data);
    }
}
