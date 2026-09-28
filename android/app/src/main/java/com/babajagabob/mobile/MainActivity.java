package com.babajagabob.mobile;

import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import android.app.Activity;

public final class MainActivity extends Activity {
    private int dp(float v) { return (int) (v * getResources().getDisplayMetrics().density + 0.5f); }

    private TextView text(String value, float size, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        return v;
    }

    private LinearLayout card(String title, String value, String detail) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(18), dp(16), dp(18), dp(16));
        box.setBackgroundColor(Color.rgb(21, 27, 35));

        TextView t = text(title, 13, Color.rgb(155,168,183), false);
        TextView v = text(value, 22, Color.WHITE, true);
        TextView d = text(detail, 12, Color.rgb(155,168,183), false);
        box.addView(t);
        box.addView(v, new LinearLayout.LayoutParams(-1, -2));
        box.addView(d);
        return box;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(11,15,20));
        getWindow().setNavigationBarColor(Color.rgb(11,15,20));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(11,15,20));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(28));

        TextView eyebrow = text("AUTONOMOUS AGENT PLATFORM", 11, Color.rgb(124,156,255), true);
        root.addView(eyebrow);

        TextView title = text("BabajagaBoB", 32, Color.WHITE, true);
        title.setPadding(0, dp(4), 0, dp(4));
        root.addView(title);

        TextView subtitle = text("Control Center · Android 11–16", 15, Color.rgb(155,168,183), false);
        root.addView(subtitle);

        TextView status = text("●  BEREIT", 13, Color.rgb(85,214,160), true);
        status.setPadding(0, dp(18), 0, dp(20));
        root.addView(status);

        LinearLayout grid = new LinearLayout(this);
        grid.setOrientation(LinearLayout.VERTICAL);
        String[][] cards = {
            {"Agents", "0 aktiv", "Agent Fabric"},
            {"Tasks", "0 laufend", "Queue / Worker"},
            {"Experimente", "0", "Evidence & Validation"},
            {"Security", "Fail-closed", "Authority / Policy"}
        };
        for (String[] c : cards) {
            LinearLayout cv = card(c[0], c[1], c[2]);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(112));
            lp.setMargins(0, 0, 0, dp(10));
            grid.addView(cv, lp);
        }
        root.addView(grid);

        TextView info = text(
            "Die Android-App ist eine sichere Client-Oberfläche. Zugangsdaten und Control-Plane-Tokens werden nicht in der APK gespeichert.",
            13, Color.rgb(155,168,183), false);
        info.setPadding(0, dp(10), 0, dp(18));
        root.addView(info);

        Button open = new Button(this);
        open.setText("CONTROL CENTER ÖFFNEN");
        open.setTextColor(Color.WHITE);
        open.setBackgroundColor(Color.rgb(76, 101, 190));
        open.setAllCaps(false);
        open.setOnClickListener(v -> openControlCenter());
        root.addView(open, new LinearLayout.LayoutParams(-1, dp(52)));

        Button about = new Button(this);
        about.setText("Sicherheits- und Laufzeitstatus");
        about.setTextColor(Color.rgb(220,226,235));
        about.setBackgroundColor(Color.rgb(28,36,48));
        about.setAllCaps(false);
        about.setOnClickListener(v -> Toast.makeText(this,
                "Network-Zugriff erfolgt ausschließlich zum konfigurierten Control Plane. Keine Credentials im Client.",
                Toast.LENGTH_LONG).show());
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-1, dp(52));
        ap.setMargins(0, dp(10), 0, 0);
        root.addView(about, ap);

        scroll.addView(root);
        setContentView(scroll);
    }

    private void openControlCenter() {
        String url = BuildConfig.CONTROL_PLANE_URL;
        if (url == null || url.trim().isEmpty()) {
            Toast.makeText(this,
                    "Noch kein Control-Plane-Endpunkt konfiguriert. Die APK bleibt lokal sicher funktionsfähig.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        WebView web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl(Uri.parse(url).toString());
        setContentView(web);
    }
}
