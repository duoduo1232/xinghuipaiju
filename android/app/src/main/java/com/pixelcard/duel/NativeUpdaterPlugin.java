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
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) {
          throw new Exception("Unable to create update cache directory");
        }

        File apkFile = new File(dir, fileName.endsWith(".apk") ? fileName : fileName + ".apk");
        File metaFile = new File(dir, apkFile.getName() + ".meta");
        if (isCachedApkReady(apkFile, metaFile, urlText)) {
            notifyDownloadProgress(apkFile.length(), apkFile.length());
            return apkFile;
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        connection.connect();

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            throw new Exception("Download failed, server returned " + status);
        }
        long totalBytes = connection.getContentLengthLong();

        File partialFile = new File(dir, apkFile.getName() + ".part");
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partialFile, false)) {
            byte[] buffer = new byte[8192];
            int read;
            long downloadedBytes = 0;
            notifyDownloadProgress(0, totalBytes);
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                downloadedBytes += read;
                notifyDownloadProgress(downloadedBytes, totalBytes);
            }
        } finally {
            connection.disconnect();
        }

        if (apkFile.exists() && !apkFile.delete()) {
            throw new Exception("Unable to replace old cached APK");
        }
        if (!partialFile.renameTo(apkFile)) {
            throw new Exception("Unable to save downloaded APK");
        }
        writeCacheMeta(metaFile, urlText, apkFile.length());

        if (totalBytes > 0) {
            notifyDownloadProgress(totalBytes, totalBytes);
        }
        return apkFile;
    }

    private boolean isCachedApkReady(File apkFile, File metaFile, String urlText) {
        if (!apkFile.exists() || apkFile.length() <= 0 || !metaFile.exists()) {
            return false;
        }
        try {
            String meta = readTextFile(metaFile);
            return meta.contains("url=" + urlText + "\n") && meta.contains("size=" + apkFile.length() + "\n");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void writeCacheMeta(File metaFile, String urlText, long size) {
        try {
            String meta = "url=" + urlText + "\nsize=" + size + "\n";
            try (FileOutputStream output = new FileOutputStream(metaFile, false)) {
                output.write(meta.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
        }
    }

    private String readTextFile(File file) throws Exception {
        try (InputStream input = new java.io.FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void notifyDownloadProgress(long downloadedBytes, long totalBytes) {
        JSObject payload = new JSObject();
        payload.put("downloaded", downloadedBytes);
        payload.put("total", totalBytes);
        if (totalBytes > 0) {
            payload.put("percent", Math.max(0, Math.min(100, Math.round((downloadedBytes * 100f) / totalBytes))));
        }
        notifyListeners("downloadProgress", payload, true);
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
