from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
import json
import os
from datetime import datetime, timezone
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score, mean_absolute_percentage_error
from sklearn.utils import resample

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# MODEL_DIR: default ke <project_root>/models, bisa di-override via env var.
# ---------------------------------------------------------------------------
_default_model_dir = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models'
)
MODEL_DIR = os.environ.get('RUNPACE_MODEL_DIR', _default_model_dir)

# ---------------------------------------------------------------------------
# Fallback hybrid config — dipakai hanya jika hybrid_config.json belum ada.
# ---------------------------------------------------------------------------
_FALLBACK_CONFIG = {
    'best_alpha'               : 0.70,
    'gender_ratio_F'           : 1.08,
    'pace_base_seconds_per_km' : {
        'Advanced'    : 300.0,
        'Intermediate': 390.0,
        'Beginner'    : 480.0,
    },
}

_MODELS_OK               = False
_LOAD_ERROR              = None
_hybrid_cfg              = {}
classifier_feature_names = []
feature_names            = []
_clf_models              = {}
_reg_models              = {}

try:
    _clf_models['rf'] = joblib.load(os.path.join(MODEL_DIR, 'runpace_classifier.pkl'))
    _reg_models['rf'] = joblib.load(os.path.join(MODEL_DIR, 'runpace_regressor.pkl'))

    for algo, fname in [('svm', 'runpace_classifier_svm.pkl'), ('knn', 'runpace_classifier_knn.pkl')]:
        _path = os.path.join(MODEL_DIR, fname)
        if os.path.exists(_path):
            _clf_models[algo] = joblib.load(_path)
            print(f"[RunPace] Loaded classifier: {algo}")

    for algo, fname in [('lr', 'runpace_regressor_lr.pkl'), ('gb', 'runpace_regressor_gb.pkl')]:
        _path = os.path.join(MODEL_DIR, fname)
        if os.path.exists(_path):
            _reg_models[algo] = joblib.load(_path)
            print(f"[RunPace] Loaded regressor: {algo}")

    classifier_feature_names = list(_clf_models['rf'].feature_names_in_)
    feature_names            = list(_reg_models['rf'].feature_names_in_)

    print(f"[RunPace] Classifier fitur ({len(classifier_feature_names)}): "
          f"{classifier_feature_names}")
    print(f"[RunPace] Regressor fitur  ({len(feature_names)}): "
          f"{feature_names}")

    cfg_path = os.path.join(MODEL_DIR, 'hybrid_config.json')
    if os.path.exists(cfg_path):
        with open(cfg_path) as _f:
            _hybrid_cfg = json.load(_f)
        print(f"[RunPace] hybrid_config.json loaded: "
              f"alpha={_hybrid_cfg['best_alpha']}, "
              f"gender_ratio={_hybrid_cfg['gender_ratio_F']:.4f}")
    else:
        _hybrid_cfg = _FALLBACK_CONFIG
        print("[RunPace] WARNING: hybrid_config.json tidak ditemukan. "
              "Menggunakan fallback constants.")

    _MODELS_OK = True
    print("[RunPace] Semua model berhasil dimuat.")

except Exception as exc:
    _LOAD_ERROR = str(exc)
    print(f"[RunPace] ERROR saat load model: {_LOAD_ERROR}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_duration(total_seconds: float) -> str:
    total_seconds = max(0.0, total_seconds)
    hours   = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = int(total_seconds % 60)
    if hours > 0:
        return f"{hours} jam {minutes} menit {seconds} detik"
    return f"{minutes} menit {seconds} detik"


def _apply_sanity_gate(
    training_dist_km: float,
    raw_kasta: str,
    jarak_km: float,
    heart_rate: float,
) -> tuple:
    """
    Model Correction Layer berbasis aturan sport science.

    Latar belakang kebutuhan fungsi ini:
    K-Means pada dataset ini mengelompokkan berdasarkan JENIS SESI LATIHAN
    (mountain run vs tempo run vs easy run), bukan berdasarkan level pengalaman pelari.
    Hasilnya: RF Classifier belajar bahwa HR tinggi pada jarak pendek = Advanced,
    yang secara medis dan fisiologis terbalik. Gate ini menegakkan batasan berbasis
    ilmu olahraga nyata sebelum output dikirim ke pengguna.

    Aturan yang diterapkan:

    [CAP DOWN — Mencegah klasifikasi terlalu tinggi]
    Gate 1 (Distance Floor): training_dist < 5 km  → paksa Beginner.
        Justifikasi: Pelari yang konsisten sub-5km belum memiliki base aerobik yang
        cukup untuk level Intermediate/Advanced dalam konteks lomba apa pun.

    Gate 2 (Distance Cap): training_dist < 10 km AND kasta == Advanced → turunkan ke Intermediate.
        Justifikasi: Standar pelatihan marathon: pelari harus rutin lari 10km+ sebelum
        dianggap Advanced. Sub-10km adalah fase "building base" atau intermediate.

    Gate 3 (Cardiac Efficiency Cap): cardiac_cost > 20 bpm/km AND kasta == Advanced
        → turunkan ke Intermediate.
        Justifikasi: cardiac_cost = HR / dist_km. Nilai tinggi = jantung bekerja keras
        per km = aerobically inefficient. Advanced runner memiliki cardiac_cost rendah
        (Advanced cluster median: 7.06 bpm/km). Gate ini memberi perlindungan ekstra
        untuk pelari yang HR-nya sangat tinggi relatif terhadap jarak tempuh.

    Gate 4 (Cardiac Overload): cardiac_cost > 35 bpm/km → paksa Beginner.
        Justifikasi: 35+ bpm/km = jantung beroperasi di zona anaerobik bahkan pada
        jarak pendek. Ini adalah indikator ketidaksiapan aerobik yang tidak ambigu.
        Contoh: 3km + HR 168 = cardiac_cost 56 bpm/km. Tidak ada pelari Advanced
        dalam dataset yang memiliki cardiac_cost mendekati angka ini (dataset max: 17.45).

    [LIFT UP — Mencegah klasifikasi terlalu rendah]
    Gate 5 (Efficiency Floor): training_dist >= 15 km AND cardiac_cost < 10 bpm/km
        AND kasta == Beginner → naikkan ke Intermediate.
        Justifikasi: Pelari dengan long run konsisten 15km+ dan efisiensi kardiovaskular
        tinggi (mirip centroid Advanced: 7.06 bpm/km) seharusnya minimal Intermediate.
        Gate ini menangkap kasus inversi K-Means di mana long efficient runner salah
        diklasifikasi sebagai Beginner karena cluster semantics yang terbalik.

    [PENALTY — Koreksi durasi untuk underprepared race target]
    Adequacy penalty: meningkatkan durasi prediksi jika rata-rata sesi latihan jauh
    di bawah jarak lomba yang ditarget. Berbasis asas "long run adequacy" dalam
    pelatihan marathon (target long run >= 75% dari race distance sebelum hari H).
    """
    cardiac_cost   = heart_rate / training_dist_km
    kasta          = raw_kasta
    gate_reasons   = []

    # Gate 1
    if training_dist_km < 5.0:
        kasta = 'Beginner'
        gate_reasons.append(
            f'Gate1: training_dist {training_dist_km:.1f}km < 5km minimum aerobic base floor'
        )
    # Gate 2 (hanya jika Gate 1 belum trigger)
    elif training_dist_km < 10.0 and kasta == 'Advanced':
        kasta = 'Intermediate'
        gate_reasons.append(
            f'Gate2: training_dist {training_dist_km:.1f}km < 10km; Advanced cap diturunkan ke Intermediate'
        )

    # Gate 3
    if cardiac_cost > 20.0 and kasta == 'Advanced':
        kasta = 'Intermediate'
        gate_reasons.append(
            f'Gate3: cardiac_cost {cardiac_cost:.1f} bpm/km > 20; Advanced cap diturunkan ke Intermediate'
        )

    # Gate 4 (lebih kuat dari Gate 3 — override ke Beginner)
    if cardiac_cost > 35.0:
        kasta = 'Beginner'
        gate_reasons.append(
            f'Gate4: cardiac_cost {cardiac_cost:.1f} bpm/km > 35; paksa Beginner (anaerobik overload)'
        )

    # Gate 5 — lift-up untuk long efficient runner yang misklaifikasi sebagai Beginner
    if training_dist_km >= 15.0 and cardiac_cost < 10.0 and kasta == 'Beginner':
        kasta = 'Intermediate'
        gate_reasons.append(
            f'Gate5: training_dist {training_dist_km:.1f}km >= 15km & cardiac_cost {cardiac_cost:.1f} < 10; '
            f'dinaikkan dari Beginner ke Intermediate'
        )

    # Adequacy penalty
    adequacy_ratio = training_dist_km / jarak_km
    if adequacy_ratio < 0.25:
        penalty_seconds = jarak_km * 120.0
        gate_reasons.append(
            f'Penalty: adequacy_ratio {adequacy_ratio:.3f} < 0.25; +{penalty_seconds/60:.0f}min '
            f'({jarak_km:.1f}km race x 2min/km penalty)'
        )
    elif adequacy_ratio < 0.50:
        penalty_seconds = jarak_km * 60.0
        gate_reasons.append(
            f'Penalty: adequacy_ratio {adequacy_ratio:.3f} < 0.50; +{penalty_seconds/60:.0f}min '
            f'({jarak_km:.1f}km race x 1min/km penalty)'
        )
    elif adequacy_ratio < 0.75:
        penalty_seconds = jarak_km * 30.0
        gate_reasons.append(
            f'Penalty: adequacy_ratio {adequacy_ratio:.3f} < 0.75; +{penalty_seconds/60:.0f}min '
            f'({jarak_km:.1f}km race x 0.5min/km penalty)'
        )
    else:
        penalty_seconds = 0.0

    return kasta, penalty_seconds, cardiac_cost, adequacy_ratio, gate_reasons


def _validate_input(data: dict):
    """
    Validates and parses all input fields.

    training_dist_km  — rata-rata jarak sesi latihan historis (dipakai classifier).
    jarak_km          — jarak resmi kategori lomba (dipakai regressor).
    heart_rate        — rata-rata HR dari sesi latihan (dipakai classifier & regressor).
    """
    try:
        training_dist_km = float(data.get('training_dist_km', data.get('jarak_km', 5.0)))
        jarak_km         = float(data.get('jarak_km',         5.0))
        elevasi_m        = float(data.get('elevasi_m',        25.0))
        gender           = str(data.get('gender',         'M')).strip().upper()
        jam_lari         = int(data.get('jam_lari',        6))
        heart_rate       = float(data.get('heart_rate',   150.0))
    except (TypeError, ValueError) as exc:
        return None, f"Tipe data tidak valid: {exc}"

    if not (1.0 <= training_dist_km <= 30.0):
        return None, "training_dist_km harus antara 1.0 dan 30.0"
    if not (0.1 <= jarak_km <= 100):
        return None, "jarak_km harus antara 0.1 dan 100"
    if not (0 <= elevasi_m <= 5000):
        return None, "elevasi_m harus antara 0 dan 5000"
    if gender not in ('M', 'F'):
        return None, "gender harus 'M' atau 'F'"
    if not (0 <= jam_lari <= 23):
        return None, "jam_lari harus antara 0 dan 23"
    if not (40 <= heart_rate <= 220):
        return None, "heart_rate harus antara 40 dan 220 BPM"

    return {
        'training_dist_km': training_dist_km,
        'jarak_km'        : jarak_km,
        'elevasi_m'       : elevasi_m,
        'gender'          : gender,
        'jam_lari'        : jam_lari,
        'heart_rate'      : heart_rate,
    }, None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status'       : 'ok' if _MODELS_OK else 'degraded',
        'models_loaded': _MODELS_OK,
        'error'        : 'Model initialization failed' if _LOAD_ERROR else None,
        'timestamp'    : datetime.now(timezone.utc).isoformat(),
    }), 200 if _MODELS_OK else 503


@app.route('/api/model-info', methods=['GET'])
def model_info():
    if not _MODELS_OK:
        return jsonify({'status': 'error', 'message': 'Models not loaded'}), 503

    return jsonify({
        'status'    : 'ok',
        'classifier': {
            'type'    : type(_clf_models['rf']).__name__,
            'classes' : list(_clf_models['rf'].classes_),
            'features': classifier_feature_names,
            'note'    : 'Uses training_dist_km (historical profile), NOT race distance',
        },
        'regressor' : {
            'type'    : type(_reg_models['rf']).__name__,
            'features': feature_names,
            'note'    : 'Uses jarak_km (official race distance) for duration prediction',
        },
        'hybrid_formula': {
            'alpha_physics'           : _hybrid_cfg['best_alpha'],
            'alpha_ml'                : round(1 - _hybrid_cfg['best_alpha'], 4),
            'pace_base_seconds_per_km': _hybrid_cfg['pace_base_seconds_per_km'],
            'gender_ratio_F_over_M'   : _hybrid_cfg['gender_ratio_F'],
        },
    }), 200


@app.route('/api/predict', methods=['POST'])
def predict_runpace():
    if not _MODELS_OK:
        return jsonify({
            'status' : 'error',
            'message': 'Model belum siap. Periksa /api/health untuk detail.'
        }), 503

    # 1. Parse dan validasi input
    data = request.get_json(force=True, silent=True) or {}
    parsed, err = _validate_input(data)
    if err:
        return jsonify({'status': 'error', 'message': err}), 400

    _clf_algo     = data.get('classifier_algo', 'rf')
    _reg_algo     = data.get('regressor_algo', 'rf')
    active_clf    = _clf_models.get(_clf_algo, _clf_models['rf'])
    active_reg    = _reg_models.get(_reg_algo, _reg_models['rf'])
    clf_algo_used = _clf_algo if _clf_algo in _clf_models else 'rf'
    reg_algo_used = _reg_algo if _reg_algo in _reg_models else 'rf'

    training_dist_km  = parsed['training_dist_km']
    jarak_km          = parsed['jarak_km']
    elevasi_m         = parsed['elevasi_m']
    gender            = parsed['gender']
    jam_lari          = parsed['jam_lari']
    heart_rate        = parsed['heart_rate']

    # Jarak lomba dalam meter — dipakai regressor untuk estimasi durasi finish
    jarak_meter = jarak_km * 1000.0

    # ---------------------------------------------------------------------------
    # 2. CLASSIFIER — menggunakan data profil latihan historis pelari.
    # ---------------------------------------------------------------------------
    training_dist_meter = training_dist_km * 1000.0

    _clf_pool = {
        'distance (m)'            : training_dist_meter,
        'elevation gain (m)'      : elevasi_m,
        'average heart rate (bpm)': heart_rate,
    }
    input_class = pd.DataFrame(
        [[_clf_pool[col] for col in classifier_feature_names]],
        columns=classifier_feature_names
    )

    raw_kasta = active_clf.predict(input_class)[0]
    proba_raw = active_clf.predict_proba(input_class)[0]
    confidence = {
        str(kls): round(float(prob), 4)
        for kls, prob in zip(active_clf.classes_, proba_raw)
    }

    # ---------------------------------------------------------------------------
    # 2b. SANITY GATE — koreksi berbasis aturan sport science.
    #
    # RF Classifier mengandung systematic bias karena K-Means mengelompokkan
    # berdasarkan jenis sesi latihan (mountain run / tempo / easy), bukan level
    # pengalaman pelari. Hasilnya: HR tinggi pada jarak pendek salah diklasifikasi
    # sebagai Advanced. Gate ini memperbaiki output sebelum diteruskan ke regressor.
    # ---------------------------------------------------------------------------
    tingkat_pengalaman, penalty_seconds, cardiac_cost, adequacy_ratio, gate_reasons = (
        _apply_sanity_gate(training_dist_km, raw_kasta, jarak_km, heart_rate)
    )

    # ---------------------------------------------------------------------------
    # 3. REGRESSOR — menggunakan jarak resmi lomba untuk estimasi waktu tempuh.
    # Kasta yang dipakai adalah hasil setelah Sanity Gate, bukan raw classifier.
    # ---------------------------------------------------------------------------
    gender_M         = 1 if gender == 'M' else 0
    waktu_pagi       = 1 if 5  <= jam_lari < 11 else 0
    waktu_siang      = 1 if 11 <= jam_lari < 16 else 0
    exp_intermediate = 1 if tingkat_pengalaman == 'Intermediate' else 0
    exp_advanced     = 1 if tingkat_pengalaman == 'Advanced'     else 0

    _reg_pool = {
        'distance (m)'                   : jarak_meter,
        'elevation gain (m)'             : elevasi_m,
        'gender_M'                       : gender_M,
        'Waktu_Lari_Pagi'                : waktu_pagi,
        'Waktu_Lari_Siang'               : waktu_siang,
        'average heart rate (bpm)'       : heart_rate,
        'Tingkat_Pengalaman_Intermediate': exp_intermediate,
        'Tingkat_Pengalaman_Advanced'    : exp_advanced,
    }
    input_reg = pd.DataFrame(
        [[_reg_pool[col] for col in feature_names]],
        columns=feature_names
    )

    # 4. Prediksi durasi dari RF Regressor
    pred_rf_detik = float(active_reg.predict(input_reg)[0])

    # 5. Formula Hybrid
    alpha        = _hybrid_cfg['best_alpha']
    pace_base    = _hybrid_cfg['pace_base_seconds_per_km'].get(tingkat_pengalaman, 420.0)
    gender_ratio = _hybrid_cfg['gender_ratio_F']

    durasi_fisik = jarak_km * pace_base
    if gender == 'F':
        durasi_fisik *= gender_ratio

    prediksi_base = alpha * durasi_fisik + (1 - alpha) * pred_rf_detik

    # 5b. Terapkan adequacy penalty dari Sanity Gate
    prediksi_final = prediksi_base + penalty_seconds

    # 6. Hitung pace string dari durasi final (termasuk penalty)
    pace_per_km = (prediksi_final / 60.0) / jarak_km
    pace_menit  = int(pace_per_km)
    pace_detik  = int((pace_per_km - pace_menit) * 60)

    return jsonify({
        'status': 'success',
        'hasil' : {
            'tingkat_pengalaman': tingkat_pengalaman,
            'confidence'        : confidence,
            'rekomendasi_pace'  : f"{pace_menit}:{pace_detik:02d} /km",
            'estimasi_durasi'   : _format_duration(prediksi_final),
            'total_detik'       : round(prediksi_final, 2),
        },
        'debug' : {
            'rf_raw_detik'         : round(pred_rf_detik, 2),
            'physics_detik'        : round(durasi_fisik, 2),
            'alpha_used'           : alpha,
            'pace_base_used'       : pace_base,
            'training_dist_km_used': training_dist_km,
            'race_dist_km_used'    : jarak_km,
            'raw_kasta_classifier' : raw_kasta,
            'cardiac_cost_per_km'  : round(cardiac_cost, 2),
            'adequacy_ratio'       : round(adequacy_ratio, 3),
            'penalty_seconds'      : round(penalty_seconds, 1),
            'gate_triggered'       : len(gate_reasons) > 0,
            'gate_reasons'         : gate_reasons,
            'algo_used'            : {'classifier': clf_algo_used, 'regressor': reg_algo_used},
        },
    }), 200


@app.route('/api/feedback', methods=['POST'])
def record_feedback():
    data      = request.get_json(force=True, silent=True) or {}
    rating    = data.get('rating')
    comment   = str(data.get('comment', '')).strip()

    if not isinstance(rating, int) or not (1 <= rating <= 5):
        return jsonify({'status': 'error', 'message': 'rating harus integer antara 1 dan 5'}), 400

    feedback_path = '/app/data/feedback.csv'
    os.makedirs(os.path.dirname(feedback_path), exist_ok=True)
    write_header = not os.path.exists(feedback_path)

    # Wrap comment in double-quotes and escape any embedded double-quotes
    # per RFC 4180 so commas and newlines inside comments do not corrupt the CSV.
    if comment and comment[0] in ('=', '+', '-', '@'):
        comment = '\t' + comment
    safe_comment = '"' + comment.replace('"', '""') + '"'
    timestamp    = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    row          = f'{timestamp},{rating},{safe_comment}\n'

    with open(feedback_path, 'a', encoding='utf-8') as f:
        if write_header:
            f.write('timestamp,rating,comment\n')
        f.write(row)

    return jsonify({'status': 'success', 'message': 'Feedback recorded successfully'}), 200


@app.route('/api/retrain', methods=['POST'])
def retrain_models():
    global _clf_models, _reg_models, _MODELS_OK, classifier_feature_names, feature_names

    data           = request.get_json(force=True, silent=True) or {}
    test_size      = max(0.1, min(0.5, data.get('test_size', 0.2)))
    random_state   = int(data.get('random_state', 42))
    scaling_method = data.get('scaling_method', 'standard')
    clf_algo       = data.get('classifier_algo', 'rf')
    reg_algo       = data.get('regressor_algo', 'rf')
    n_estimators   = max(10, min(300, int(data.get('n_estimators', 100))))

    # Cari dataset relatif dari lokasi file ini
    _base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_path = os.path.join(_base, 'notebooks', 'DataSet_Lari.csv')
    if not os.path.exists(csv_path):
        return jsonify({'status': 'error', 'message': f'Dataset tidak ditemukan: {csv_path}'}), 500

    try:
        # ── Load & Clean ────────────────────────────────────────────────────
        df = pd.read_csv(csv_path, sep=';')
        df['dt']    = pd.to_datetime(df['timestamp'], format='%d/%m/%Y %H:%M')
        df['hour']  = df['dt'].dt.hour
        df = df.dropna(subset=['gender'])
        df = df[(df['average heart rate (bpm)'] > 0) & df['average heart rate (bpm)'].notna()]
        df = df[df['average heart rate (bpm)'] <= 220]
        df['speed_m_s'] = df['distance (m)'] / df['elapsed time (s)']
        df = df[(df['speed_m_s'] >= 1.0) & (df['speed_m_s'] <= 8.0)]
        df = df[df['distance (m)'] <= 50000]

        # ── Feature engineering ─────────────────────────────────────────────
        def kelompokkan_waktu(jam):
            if 5 <= jam < 11: return 'Pagi'
            elif 11 <= jam < 16: return 'Siang'
            return 'Malam'

        df['Waktu_Lari']  = df['hour'].apply(kelompokkan_waktu)
        df['gender_M']    = (df['gender'] == 'M').astype(int)
        df['Waktu_Lari_Pagi']  = (df['Waktu_Lari'] == 'Pagi').astype(int)
        df['Waktu_Lari_Siang'] = (df['Waktu_Lari'] == 'Siang').astype(int)

        # ── KMeans clustering ───────────────────────────────────────────────
        fitur_klaster = ['distance (m)', 'elevation gain (m)', 'average heart rate (bpm)']
        scaler_km = StandardScaler()
        X_scaled  = scaler_km.fit_transform(df[fitur_klaster])
        km = KMeans(n_clusters=3, random_state=random_state, n_init=10)
        df['Cluster_ID'] = km.fit_predict(X_scaled)
        rata_jarak = df.groupby('Cluster_ID')['distance (m)'].mean().sort_values()
        pemetaan   = {rata_jarak.index[0]: 'Beginner', rata_jarak.index[1]: 'Intermediate', rata_jarak.index[2]: 'Advanced'}
        df['Tingkat_Pengalaman'] = df['Cluster_ID'].map(pemetaan)

        # ── Balancing ───────────────────────────────────────────────────────
        counts = df['Tingkat_Pengalaman'].value_counts()
        n      = min(int(counts.min()), 5000)
        df_bal = pd.concat([
            df[df['Tingkat_Pengalaman'] == k].sample(n=n, replace=False, random_state=random_state)
            for k in ['Beginner', 'Intermediate', 'Advanced']
        ]).sample(frac=1, random_state=random_state).reset_index(drop=True)

        df_bal['Tingkat_Pengalaman_Intermediate'] = (df_bal['Tingkat_Pengalaman'] == 'Intermediate').astype(int)
        df_bal['Tingkat_Pengalaman_Advanced']     = (df_bal['Tingkat_Pengalaman'] == 'Advanced').astype(int)

        # ── Optional scaling ────────────────────────────────────────────────
        clf_features = ['distance (m)', 'elevation gain (m)', 'average heart rate (bpm)']
        reg_features = ['distance (m)', 'elevation gain (m)', 'gender_M', 'Waktu_Lari_Pagi',
                        'Waktu_Lari_Siang', 'average heart rate (bpm)',
                        'Tingkat_Pengalaman_Intermediate', 'Tingkat_Pengalaman_Advanced']

        X_c = df_bal[clf_features]
        y_c = df_bal['Tingkat_Pengalaman']
        X_r = df_bal[reg_features]
        y_r = df_bal['elapsed time (s)']

        if scaling_method in ('standard', 'minmax'):
            _scaler = StandardScaler() if scaling_method == 'standard' else MinMaxScaler()
            X_c = pd.DataFrame(_scaler.fit_transform(X_c), columns=clf_features)
            X_r = pd.DataFrame(_scaler.fit_transform(X_r), columns=reg_features)

        X_train_c, X_test_c, y_train_c, y_test_c = train_test_split(X_c, y_c, test_size=test_size, random_state=random_state, stratify=y_c)
        X_train_r, X_test_r, y_train_r, y_test_r = train_test_split(X_r, y_r, test_size=test_size, random_state=random_state)

        # ── Train Classifier ────────────────────────────────────────────────
        if clf_algo == 'svm':
            new_clf = SVC(kernel='rbf', C=10, gamma='scale', probability=True, random_state=random_state)
        elif clf_algo == 'knn':
            new_clf = KNeighborsClassifier(n_neighbors=5)
        else:
            new_clf = RandomForestClassifier(n_estimators=n_estimators, random_state=random_state, class_weight='balanced', n_jobs=-1)
        new_clf.fit(X_train_c, y_train_c)
        clf_acc = accuracy_score(y_test_c, new_clf.predict(X_test_c))

        # ── Train Regressor ─────────────────────────────────────────────────
        if reg_algo == 'lr':
            new_reg = LinearRegression()
        elif reg_algo == 'gb':
            new_reg = GradientBoostingRegressor(n_estimators=n_estimators, random_state=random_state)
        else:
            new_reg = RandomForestRegressor(n_estimators=n_estimators, random_state=random_state, n_jobs=-1)
        new_reg.fit(X_train_r, y_train_r)
        pred_r   = new_reg.predict(X_test_r)
        reg_mae  = mean_absolute_error(y_test_r, pred_r)
        reg_mape = mean_absolute_percentage_error(y_test_r, pred_r) * 100
        reg_r2   = r2_score(y_test_r, pred_r)

        # ── Update in-memory models ─────────────────────────────────────────
        _clf_models[clf_algo] = new_clf
        _reg_models[reg_algo] = new_reg
        classifier_feature_names = clf_features
        feature_names            = reg_features
        _MODELS_OK = True

        return jsonify({
            'status': 'success',
            'metrics': {
                'classifier': {
                    'algo'    : clf_algo,
                    'accuracy': round(clf_acc * 100, 2),
                    'samples' : len(X_train_c),
                    'test_size': int(test_size * 100),
                },
                'regressor': {
                    'algo'       : reg_algo,
                    'mae_minutes': round(reg_mae / 60, 2),
                    'mape'       : round(reg_mape, 2),
                    'r2'         : round(reg_r2, 4),
                    'samples'    : len(X_train_r),
                },
                'config': {
                    'random_state'  : random_state,
                    'scaling_method': scaling_method,
                    'n_estimators'  : n_estimators if clf_algo in ('rf',) or reg_algo in ('rf', 'gb') else 'N/A',
                    'train_samples' : n * 3,
                }
            }
        }), 200

    except Exception as exc:
        return jsonify({'status': 'error', 'message': str(exc)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.environ.get('FLASK_DEBUG', 'false') == 'true')
