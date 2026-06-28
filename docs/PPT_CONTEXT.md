# RunPace AI — PPT Context Document
## BINUS University · Machine Learning Final Project

> **Untuk teman-teman:** Dokumen ini berisi semua konteks teknis proyek RunPace AI secara detail.
> Gunakan dokumen ini sebagai input ke AI kamu, sebutkan slide mana yang sedang kamu kerjakan,
> dan biarkan AI-mu yang menentukan poin-poin dan narasi yang relevan untuk slide tersebut.
> Jangan ubah angka-angka di sini karena semuanya diambil langsung dari kode dan hasil eksperimen.

---

## Tim Pengembang

| Nama | NIM |
|------|-----|
| Josep Natanael Pasaribu | 2802486583 |
| Marcellino Varian Saputra | 2802457652 |
| Mark Philip Lengkong | 2802491715 |

---

## 1. Gambaran Umum Proyek

**Nama Proyek:** RunPace AI

**Deskripsi singkat:** Sistem prediksi kesiapan lomba lari dan perkiraan waktu selesai (pace), yang dibangun dari data GPS nyata aktivitas lari. Pengguna memasukkan data latihan mereka dan sistem memprediksi level pelari mereka (Advanced/Intermediate/Beginner), merekomendasikan pace target per km, memperkirakan durasi total lomba, dan memberikan verdict apakah mereka bisa selesai sebelum batas waktu resmi (Cut-Off Time / COT).

**Kategori lomba yang didukung:**
- 10K Race: 10.0 km, COT 3:30:00
- Half Marathon: 21.1 km, COT 3:30:00
- Full Marathon: 42.2 km, COT 7:00:00

---

## 2. Latar Belakang dan Motivasi

Lomba lari jarak jauh (10K, half marathon, full marathon) memiliki batas waktu resmi (Cut-Off Time / COT). Pelari yang tidak selesai sebelum COT akan didiskualifikasi dari lomba. Masalahnya:

- Banyak pelari pemula mendaftar lomba tanpa tahu apakah volume latihan mereka sudah cukup
- Tidak ada cara mudah untuk memperkirakan pace yang realistis berdasarkan histori GPS latihan nyata
- Pendekatan manual (rumus sederhana seperti McMillan Calculator) tidak mempertimbangkan profil fisiologis individual seperti elevasi rute, heart rate, dan keseimbangan antara jarak latihan vs jarak lomba

Proyek ini menjawab pertanyaan: **"Dapatkah kita memprediksi apakah seorang pelari akan selesai sebelum COT, hanya berdasarkan data GPS latihan mereka?"**

Motivasi tambahan: dataset GPS yang digunakan nyata (bukan sintetis), mengandung 42.116 baris dari sesi latihan aktual, sehingga model belajar dari pola lari dunia nyata yang messy dan bervariasi.

---

## 3. Dataset

**Sumber:** Dataset GPS lari (real-world, bukan sintetis). File: `DataSet_Lari.csv`

**Ukuran awal:** 42.116 baris

**Setelah pembersihan data:** 23.201 baris (55.1% dipertahankan)

**Baris yang dihapus:** 18.915 baris (44.9%) — mayoritas karena outlier ekstrem akibat GPS tracker yang tidak dimatikan selama 34 hari berturut-turut, menghasilkan satu sesi dengan jarak ~3.400 km dan waktu ~48.960 menit.

**Fitur yang digunakan untuk model:**
| Fitur | Tipe | Keterangan |
|-------|------|------------|
| Distance (km) | Numerik kontinu | Jarak per sesi latihan |
| ElapsedTime (min) | Numerik kontinu | Durasi per sesi latihan |
| Elevation Gain (m) | Numerik kontinu | Akumulasi ketinggian per sesi |
| Average Heart Rate (bpm) | Numerik kontinu | Detak jantung rata-rata per sesi |
| Gender (0=Laki, 1=Perempuan) | Biner | Variabel demografis |

**Target variabel:**
- Untuk klasifikasi: label cluster runner (Advanced / Intermediate / Beginner) yang dihasilkan oleh K-Means
- Untuk regresi: durasi lomba dalam detik (race_duration_seconds)

**Korelasi fitur terhadap pace:**
| Fitur | Korelasi Pearson (r) |
|-------|---------------------|
| Elapsed Time | 0.97 |
| Distance | 0.72 |
| Average Heart Rate | 0.61 |
| Elevation Gain | 0.42 |
| Gender | 0.18 |

---

## 4. Exploratory Data Analysis (EDA)

### Distribusi Variabel Utama (Histogram)

**Distance:**
- Mayoritas sesi latihan berada di rentang 3–10 km
- Distribusi right-skewed berat (ekor panjang ke kanan)
- Outlier ekstrem: satu sesi mencatat ~3.400 km akibat GPS tidak dimatikan selama 34 hari

**ElapsedTime:**
- Sebagian besar sesi antara 20–90 menit
- Korelasi sangat kuat dengan distance (r=0.97)
- Outlier ekstrem yang sama: ~48.960 menit untuk sesi GPS 34 hari

**Elevation Gain:**
- Distribusi lebih simetris dibanding distance dan waktu
- Mayoritas sesi di medan datar hingga sedang (0–150 m)
- Outlier tinggi (>940 m) berasal dari sesi trail running yang valid dan dipertahankan

### Boxplot

Boxplot menunjukkan bahwa outlier pada Distance dan ElapsedTime sangat ekstrem — jauh di luar upper whisker — sehingga tidak dapat ditampilkan dalam skala normal. Outlier ini menjadi alasan utama 18.915 baris dihapus saat data cleaning.

### Profil Cluster (Hasil K-Means)

| Cluster | Jumlah Sesi | % Dataset | Rata-rata Jarak | Elevasi Rata-rata | HR Rata-rata |
|---------|-------------|-----------|-----------------|-------------------|--------------|
| Advanced | 2.092 | 9.0% | 22,6 km | 649.7 m | 137.5 bpm |
| Beginner | 11.980 | 51.6% | 8,2 km | 59.7 m | 141.0 bpm |
| Intermediate | 9.129 | 39.4% | 12,1 km | 333.0 m | 159.8 bpm |

Interpretasi:
- **Advanced:** sesi jarak jauh, medan berbukit berat, HR terkontrol rendah — tanda aerobic efficiency tinggi
- **Beginner:** jarak pendek, medan datar, HR sedang — pelari rekreasional yang membangun base fitness
- **Intermediate:** jarak menengah, elevasi sedang, HR tertinggi — pelari yang sedang mendorong batas aerobik mereka

### Elbow Method (K-Means)

Nilai inertia untuk K=1 hingga K=10:
- K=1: 69.603
- K=2: 46.672
- K=3: 34.134 ← **ELBOW POINT (optimal)**
- K=4: 28.787
- K=5: 25.030
- K=10: 15.105

Penurunan inertia dari K=2→3 adalah 11.931 poin, sedangkan dari K=3→4 hanya 5.347 poin. Perlambatan drastis ini mengkonfirmasi K=3 sebagai jumlah cluster optimal (elbow method).

---

## 5. Formulasi Masalah ML

Proyek ini menggunakan arsitektur pipeline sekuensial 4-tahap:

### Tahap 1: Unsupervised Clustering (K-Means)
**Tujuan:** Membuat label runner class secara data-driven dari 23.201 sesi tanpa anotasi manual.
- Algoritma: K-Means, k=3
- Input: pace, distance, heart rate per sesi
- Output: label cluster (Advanced / Intermediate / Beginner) untuk setiap sesi

Alasan menggunakan K-Means sebagai tahap pertama: dataset tidak memiliki label ground-truth untuk runner class. Daripada menggunakan threshold arbitrary (misalnya "Advanced jika > 20 km"), K-Means belajar batas kelas dari distribusi data nyata.

### Tahap 2: Supervised Classification (Random Forest Classifier)
**Tujuan:** Memetakan fitur latihan individu ke runner class.
- Input: distance, elapsed time, elevation, heart rate, gender
- Output: label kelas (Advanced / Intermediate / Beginner) + confidence score per kelas
- Model utama: Random Forest Classifier (n_estimators=100)
- Alternatif tersedia: SVM (kernel RBF, C=10), KNN (k=5)

### Tahap 3: Sanity Gate (Rule-Based, 5 Layer)
**Tujuan:** Memvalidasi input sebelum memasuki regressor. Mencegah prediksi pada input yang secara fisik tidak mungkin.

| Layer | Nama | Aturan |
|-------|------|--------|
| L1 | Heart Rate Bounds | 40 ≤ heart_rate ≤ 220 bpm |
| L2 | Training Volume Gate | avg_dist ≥ race_dist × 0.35 |
| L3 | Race Distance Validity | jarak ∈ {10.0, 21.1, 42.2} km saja |
| L4 | Pace Plausibility | 3:00 ≤ predicted_pace ≤ 15:00 /km |
| L5 | COT Feasibility Verdict | total_detik vs race_cot_detik |

### Tahap 4: Regression + Physics Hybrid (RF Regressor)
**Tujuan:** Memperkirakan durasi lomba dalam detik, kemudian diblend dengan estimasi berbasis fisika.
- Model ML: Random Forest Regressor (n_estimators=100)
- Alternatif tersedia: Linear Regression, Gradient Boosting Regressor
- Output akhir = alpha × physics_estimate + (1 - alpha) × RF_raw_prediction
- Alpha yang digunakan: 0.05 (bobot sangat condong ke RF, fisika hanya sebagai penyeimbang)
- Formula fisika: menggunakan pace median dari dataset, dimodifikasi oleh elevasi gain sebagai penalti

Output akhir sistem: pace per km yang direkomendasikan, estimasi durasi total, dan verdict COT (FULLY_READY / CRITICAL_RISK / UNREALISTIC_TARGET).

---

## 6. Pemilihan Model dan Alasan

### Klasifikasi

| Model | Alasan Dipilih / Tidak Dipilih |
|-------|-------------------------------|
| Random Forest (utama) | Tahan terhadap fitur numerik campuran tanpa scaling; ensemble mengurangi overfitting; tidak sensitif terhadap outlier yang tersisa setelah cleaning |
| SVM (rbf, C=10) | Perlu StandardScaler; performa bisa baik untuk data separable tapi lebih lambat dan lebih sensitif terhadap pilihan kernel pada data mixed-feature |
| KNN (k=5) | Tidak ada fase training (lazy learner); lambat saat inference karena harus menghitung jarak ke semua training samples; sensibel terhadap skala fitur |

Random Forest dipilih sebagai default karena tidak memerlukan feature scaling dan ensemble nature-nya naturally handles noise dari data GPS.

### Regresi

| Model | Alasan Dipilih / Tidak Dipilih |
|-------|-------------------------------|
| Random Forest Regressor (utama) | Menangkap hubungan non-linear antara volume latihan dan durasi lomba; MAPE 11.52%, R²=0.9285 |
| Gradient Boosting Regressor | Alternatif; lebih akurat untuk beberapa kasus tapi training lebih lambat |
| Linear Regression | Tidak cocok karena mengasumsikan linearitas; hubungan antara distance dan race time bersifat non-linear (exponential fatigue curve); expected R² < 0.70 |

---

## 7. Setup Training dan Validasi

### Split Data
- Rasio: 80% training / 20% testing (train_test_split dengan stratifikasi berdasarkan runner class)
- Random seed: 42 (digunakan konsisten untuk K-Means, RF Classifier, dan RF Regressor)
- Jumlah test set: 1.184 sampel

### Class Balancing (untuk Klasifikasi)
Setelah K-Means melabeli 23.201 sesi, ditemukan class imbalance parah:
- Advanced: 892 sesi
- Intermediate: 11.445 sesi
- Beginner: 10.864 sesi

Solusi: Adaptive random downsampling, setiap kelas dipotong ke 1.973 sampel.
Hasil: training set seimbang 5.919 sampel (1.973 Advanced + 1.973 Intermediate + 1.973 Beginner).

### Feature Scaling
- StandardScaler tersedia sebagai opsi (wajib untuk SVM)
- MinMaxScaler tersedia sebagai opsi alternatif
- Random Forest tidak memerlukan scaling (default: no scaling)

### Validasi
- 5-Fold Cross Validation digunakan untuk classifier dan regressor
- Model di-save sebagai file .pkl dan di-load saat startup
- Sistem juga mendukung retrain on-the-fly via endpoint `/api/retrain` (in-memory, tidak persisten ke disk)

---

## 8. Metrik Evaluasi dan Hasil

### Classifier (Random Forest)

| Metrik | Hold-out (20%) | 5-Fold CV |
|--------|---------------|-----------|
| Accuracy | 99.24% | 98.82% |
| F1 Score (weighted) | — | 0.9882 |
| CV Stability (±std) | — | ±0.16% |

Confusion matrix (hold-out, n=1.184):
- Hanya 9 misclassification dari 1.184 sampel
- 2 Beginner diklasifikasi sebagai Advanced (sesi dengan jarak unusually panjang di batas cluster)
- 5 Intermediate diklasifikasi sebagai Advanced (sesi dengan elevasi tinggi yang mirip profil elite)
- 2 Intermediate diklasifikasi sebagai Beginner (sesi dengan jarak dan HR di bawah rata-rata)

### Regressor (Random Forest + Physics Hybrid)

| Metrik | Hold-out (20%) | 5-Fold CV |
|--------|---------------|-----------|
| MAPE | 11.52% | ~11.8% |
| R² Score | 0.8958 | 0.9285 ± 0.0159 |
| MAE | 716.4 detik (~11.9 menit) | 682.7 ± 19.5 detik |
| RMSE | 1.477.6 detik (~24.6 menit) | — |

Interpretasi:
- MAPE 11.52% berarti rata-rata error prediksi durasi lomba adalah 11.5%. Untuk marathon 4 jam, ini setara error ±27 menit.
- R²=0.9285 (CV) berarti model menjelaskan 92.85% variansi durasi lomba.
- Gap hold-out vs CV R² (0.0327) kecil, menunjukkan model tidak overfitting.
- Distribusi residual error: 80%+ prediksi berada dalam ±2.000 detik (±33 menit) dari nilai aktual.

### Ablation Study (n_estimators)
Akurasi meningkat signifikan dari 10 → 100 trees; di atas 200 trees menunjukkan diminishing returns dengan training time yang naik signifikan. Default 100 trees dipilih sebagai trade-off optimal.

---

## 9. Arsitektur Deployment

### Stack Teknologi

**Frontend:**
- Framework: Next.js 16 + React 19 + TypeScript
- Styling: Tailwind CSS v4
- Hosting: Vercel (Static + Serverless)

**Backend:**
- Framework: Flask (Python)
- ML Library: scikit-learn + joblib + pandas + numpy
- Hosting: Vercel Serverless Functions (Python runtime)

**Routing:**
- Semua request `/api/*` dari frontend di-route ke `api/index.py` via `vercel.json` rewrites
- Tidak menggunakan Railway atau server terpisah; satu platform Vercel menangani keduanya

### Endpoint API

| Method | Path | Fungsi |
|--------|------|--------|
| GET | `/api/health` | Health check, konfirmasi model loaded |
| POST | `/api/predict` | Prediksi runner class + durasi lomba |
| POST | `/api/retrain` | Retrain model in-memory dengan parameter baru |

### Parameter Predict
```json
{
  "avg_distance_km": float,
  "avg_heart_rate": float,
  "elevation_m": float,
  "gender": 0 or 1,
  "jam_lari": float,
  "jarak_km": float,
  "race_jarak_km": float,
  "classifier_algo": "rf" | "svm" | "knn",
  "regressor_algo": "rf" | "lr" | "gb"
}
```

### Model Registry
Model di-load saat startup sebagai dictionary (registry pattern):
- Classifier: `_clf_models = { 'rf': ..., 'svm': ..., 'knn': ... }`
- Regressor: `_reg_models = { 'rf': ..., 'lr': ..., 'gb': ... }`
- File .pkl: `runpace_classifier.pkl`, `runpace_regressor.pkl`, `runpace_kmeans.pkl`, plus 4 alternatif model

---

## 10. Fitur Aplikasi (Screenshot Reference)

Aplikasi berbentuk dashboard web dengan 6 tab yang di-lock secara sequential (user harus menyelesaikan satu tab sebelum ke tab berikutnya):

1. **About The Project** — penjelasan proyek, cara kerja sistem, statistik dataset, info tim
2. **EDA** — visualisasi interaktif: histogram dan boxplot (Distance, ElapsedTime, Elevation), scatter plot cluster, korelasi fitur
3. **Preprocessing** — konfigurasi train/test split (slider 10–50%), random state, scaling method, visualisasi class balancing sebelum/sesudah
4. **Model Training** — pilih algoritma classifier (RF/SVM/KNN) dan regressor (RF/LR/GB), pilih n_estimators, tombol Train yang menjalankan training nyata via `/api/retrain`, training log real-time
5. **Evaluation** — metrik dinamis (berubah setelah training): accuracy, MAPE, R², MAE; confusion matrix; elbow curve; residual error histogram; comparison table hold-out vs CV
6. **Simulator** — wizard 3-step: (1) input profil latihan per sesi (jarak + HR), (2) pilih kategori lomba + target jam, gender, elevasi rute, (3) hasil lengkap: runner class, confidence bar, target pace, estimasi durasi, banner COT verdict (hijau/amber/merah)

---

## 11. Desain User Testing

User testing dilakukan untuk memvalidasi apakah sistem dapat digunakan oleh target pengguna (pelari rekreasional) tanpa latar belakang teknis ML.

**Tujuan testing:**
- Apakah alur 6-tab sequential mudah dipahami?
- Apakah pengguna bisa mengisi form input (Simulator) tanpa kebingungan?
- Apakah hasil prediksi (runner class, pace, COT verdict) dapat diinterpretasikan dengan benar?
- Apakah metrik evaluasi di tab Evaluation cukup informatif tanpa penjelasan teknis?

**Profil target user:**
- Pelari rekreasional yang pernah mengikuti atau ingin mengikuti lomba lari
- Tidak harus memiliki background data science atau machine learning

**Skenario testing yang diusulkan:**
1. User diberikan akses ke aplikasi tanpa instruksi apapun selain URL
2. User diminta melengkapi flow dari tab About hingga Simulator dan mendapatkan prediksi
3. User diminta menjawab: apakah mereka percaya dengan hasil, apa yang membingungkan, dan apa yang perlu ditambahkan

**Metrik user testing:**
- Task completion rate: apakah user berhasil mencapai hasil prediksi?
- Time-on-task: berapa lama user menyelesaikan satu siklus full flow?
- Error rate: berapa kali user membuat kesalahan input yang memicu error dari Sanity Gate?
- Subjective satisfaction (skala Likert 1–5) terhadap: kemudahan penggunaan, kejelasan output, kepercayaan terhadap prediksi

---

## 12. Catatan Teknis Tambahan

**Mengapa menggunakan K-Means sebelum Random Forest (bukan langsung supervised)?**
Dataset tidak memiliki label runner class. Menggunakan threshold manual (misalnya "Advanced = jarak > 20 km") bersifat subjektif dan tidak data-driven. K-Means memungkinkan sistem menemukan cluster alami dari 23.201 sesi, kemudian label tersebut menjadi target variabel supervised yang objektif.

**Mengapa Physics Hybrid pada regressor?**
RF murni bisa overfitting pada pola training yang spesifik. Dengan memblend 5% estimasi fisika (pace median × jarak × faktor elevasi) ke dalam prediksi RF, model lebih robust terhadap edge cases yang jarang muncul di training data. Alpha 0.05 dipilih dari eksperimen grid search kecil.

**Mengapa in-memory training (tidak persist ke disk)?**
Vercel Serverless tidak mendukung write ke filesystem persisten. Training via `/api/retrain` memperbarui model dalam memory process; saat instance restart (cold start), model kembali ke versi pre-trained .pkl. Ini acceptable untuk tujuan demo akademik.

**Mengapa sequential tab lock?**
Untuk mensimulasikan alur pipeline ML yang sesungguhnya: user tidak bisa langsung ke Simulator tanpa memahami konteks data, preprocessing, dan training. Ini juga mendorong user untuk memahami semua tahap sistem.

---

*Dokumen ini dihasilkan dari source code dan data eksperimen RunPace AI secara langsung.*
*Semua angka adalah angka nyata dari hasil training dan evaluasi model.*
