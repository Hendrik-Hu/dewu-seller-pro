package com.dewu.sellerpro;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import org.json.JSONObject;

public class InventoryWidget extends AppWidgetProvider {

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager,
                                int appWidgetId) {

        // Construct the RemoteViews object
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.inventory_widget);

        // Read data from Capacitor Preferences
        // Capacitor uses "CapacitorStorage" as the shared preferences file name
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String widgetDataJson = prefs.getString("widget_data", null);

        String totalStock = "--";
        String inboundToday = "0";

        if (widgetDataJson != null) {
            try {
                JSONObject json = new JSONObject(widgetDataJson);
                totalStock = String.valueOf(json.optInt("totalStock", 0));
                inboundToday = String.valueOf(json.optInt("inboundToday", 0));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        views.setTextViewText(R.id.widget_count, totalStock);
        views.setTextViewText(R.id.widget_subtitle, "总库存 · 今日入库 " + inboundToday);

        // Instruct the widget manager to update the widget
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        // There may be multiple widgets active, so update all of them
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }
}
