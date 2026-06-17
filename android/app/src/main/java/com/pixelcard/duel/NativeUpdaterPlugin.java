package com.pixelcard.duel;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "xinghui-update.apk");

        if (url == null || url.trim().isEmpty()) {
            call.reject("Missing APK download URL");
            return;
        }

        getBridge().execute(() -> {
            try {
                File apkFile = downloadApk(url, sanitizeFileName(fileName));
                openInstaller(apkFile);

                JSObject result = new JSObject();
                result.put("path", apkFile.getAbsolutePath());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Download and install failed" : error.getMessage(), error);
            }
        });
    }

    private File downloadApk(String urlText, String fileName) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.connect();

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            throw new Exception("Download failed, server returned " + status);
        }

        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
          throw new Exception("Unable to create update cache directory");
        }

        File apkFile = new File(dir, fileName.endsWith(".apk") ? fileName : fileName + ".apk");
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apkFile)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }

        return apkFile;
    }

    private void openInstaller(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private String sanitizeFileName(String fileName) {
        String cleaned = fileName == null ? "xinghui-update.apk" : fileName.replaceAll("[^A-Za-z0-9._-]", "-");
        return cleaned.isEmpty() ? "xinghui-update.apk" : cleaned;
    }
}
