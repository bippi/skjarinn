package skjarinn.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

/**
 * Skjárinn á Android TV (NVIDIA Shield): heilskjás WebView sem opnar Skjáinn
 * á þjóninum heima. Allt viðmótið kemur frá þjóninum; appið sér bara um
 * fjarstýringuna og að spilun með hljóði sé leyfð.
 *
 * MENU-takkinn (≡) opnar stillingu á slóð þjónsins. Halda inni Til baka lokar appinu.
 */
public class MainActivity extends Activity {
    private static final String PREF_URL = "url";
    private static final String DEFAULT_URL = "http://192.168.1.10:3000/";

    private WebView web;
    private SharedPreferences prefs;
    private AlertDialog dialog;
    private boolean stopped;
    // Röng IP-tala svarar aldrei og skilar engri villu: gefast upp eftir smástund
    private final Runnable loadTimeout = () -> showUnreachable("Þjónninn svaraði ekki");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("skjarinn", MODE_PRIVATE);

        // Leyfir chrome://inspect og villuleit gegnum adb
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        hideSystemUi();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage: síðasta rás o.fl.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                web.removeCallbacks(loadTimeout);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                Log.w("Skjarinn", "Villa " + error.getDescription() + " " + request.getUrl());
                if (request.isForMainFrame()) showUnreachable(String.valueOf(error.getDescription()));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // Annars sýnir WebView gráa spilunarmynd yfir myndbandinu á meðan það hleðst
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("Skjarinn", m.messageLevel() + " " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        takeUrl(getIntent());
        String url = prefs.getString(PREF_URL, null);
        if (url == null) askUrl(); else load(url);
    }

    /** Slóð gefin með adb: am start -n skjarinn.tv/.MainActivity --es url http://… */
    private boolean takeUrl(Intent intent) {
        String url = intent == null ? null : intent.getStringExtra("url");
        if (url == null || url.isEmpty()) return false;
        prefs.edit().putString(PREF_URL, url).apply();
        return true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (takeUrl(intent)) {
            if (dialog != null && dialog.isShowing()) dialog.dismiss();
            load(prefs.getString(PREF_URL, DEFAULT_URL));
        }
    }

    private void load(String url) {
        web.removeCallbacks(loadTimeout);
        web.postDelayed(loadTimeout, 15000);
        web.loadUrl(url);
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    // ---------- Fjarstýring ----------

    /** Android-takki → keyCode sem tv.js þekkir (sama og í Tizen/vafra). */
    private static int jsKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BACK: return 27;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return 179;
            case KeyEvent.KEYCODE_MEDIA_PLAY: return 415;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return 19;
            case KeyEvent.KEYCODE_MEDIA_REWIND: return 412;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return 417;
            case KeyEvent.KEYCODE_MEDIA_STOP: return 413;
            case KeyEvent.KEYCODE_CHANNEL_UP: return 427;
            case KeyEvent.KEYCODE_CHANNEL_DOWN: return 428;
            case KeyEvent.KEYCODE_GUIDE: return 458;
            default: return 0;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (dialog != null && dialog.isShowing()) return super.dispatchKeyEvent(e);
        int code = e.getKeyCode();

        if (code == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) askUrl();
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK && e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 3) {
            finish(); // haldið inni
            return true;
        }

        int k = jsKey(code);
        if (k == 0) return super.dispatchKeyEvent(e); // örvar, OK, tölustafir: WebView sér um þá
        if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) sendKey(k);
        return true;
    }

    /** Sendir keydown inn í síðuna svo tv.js grípi hann eins og í vafra. */
    private void sendKey(int k) {
        web.evaluateJavascript(
                "(function(){var e=document.createEvent('Event');e.initEvent('keydown',true,true);"
                        + "try{Object.defineProperty(e,'keyCode',{value:" + k + "});}catch(x){e.keyCode=" + k + ";}"
                        + "document.dispatchEvent(e);})()", null);
    }

    // ---------- Slóð þjónsins ----------

    private void askUrl() {
        if (dialog != null && dialog.isShowing()) return;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setText(prefs.getString(PREF_URL, DEFAULT_URL));
        input.setSelectAllOnFocus(true);
        final boolean hasUrl = prefs.getString(PREF_URL, null) != null;
        dialog = new AlertDialog.Builder(this)
                .setTitle("Slóð á Skjáinn")
                .setMessage("Vélin heima sem keyrir Docker, t.d. http://192.168.1.10:3000")
                .setView(input)
                .setPositiveButton("Vista", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.matches("(?i)^https?://.*")) url = "http://" + url;
                    prefs.edit().putString(PREF_URL, url).apply();
                    load(url);
                })
                .setNegativeButton("Hætta við", (d, w) -> {
                    if (!hasUrl) finish();
                })
                .setCancelable(hasUrl)
                .create();
        dialog.setOnDismissListener(d -> hideSystemUi());
        dialog.show();
    }

    private void showUnreachable(String why) {
        web.removeCallbacks(loadTimeout);
        if (dialog != null && dialog.isShowing()) return;
        final String url = prefs.getString(PREF_URL, DEFAULT_URL);
        web.stopLoading();
        web.loadUrl("about:blank");
        dialog = new AlertDialog.Builder(this)
                .setTitle("Næ ekki sambandi við Skjáinn")
                .setMessage(url + "\n\n" + why + "\n\nEr Docker í gangi á vélinni heima?")
                .setPositiveButton("Reyna aftur", (d, w) -> load(url))
                .setNeutralButton("Breyta slóð", (d, w) -> web.post(this::askUrl))
                .setCancelable(false)
                .create();
        dialog.setOnDismissListener(d -> hideSystemUi());
        dialog.show();
    }

    // ---------- Líftími ----------

    @Override
    protected void onStop() {
        super.onStop();
        stopped = true;
        // Ekkert hljóð í bakgrunni eftir að farið er á heimaskjáinn
        web.evaluateJavascript("(function(){var v=document.getElementById('video');if(v)v.pause();})()", null);
        web.onPause();
    }

    @Override
    protected void onStart() {
        super.onStart();
        web.onResume();
        hideSystemUi();
        // Bein útsending er orðin úrelt eftir hlé: byrja aftur á upphafsskjánum
        if (stopped && (dialog == null || !dialog.isShowing())) load(prefs.getString(PREF_URL, DEFAULT_URL));
        stopped = false;
    }

    @Override
    protected void onDestroy() {
        web.removeCallbacks(loadTimeout);
        web.destroy();
        super.onDestroy();
    }
}
