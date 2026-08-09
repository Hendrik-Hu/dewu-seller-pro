package com.hendrikhu.sellerinventory;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        applySystemBarTheme(false);
    }

    public void applySystemBarTheme(boolean dark) {
        getWindow().setStatusBarColor(android.graphics.Color.parseColor(dark ? "#000000" : "#F8FAFC"));
        getWindow().setNavigationBarColor(android.graphics.Color.parseColor(dark ? "#000000" : "#F8FAFC"));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
