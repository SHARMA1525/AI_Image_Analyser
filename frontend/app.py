import streamlit as st
import requests
import time
import pandas as pd
from PIL import Image
import io
import os

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3000/api")

st.set_page_config(
    page_title="Vehicle Image Analyser",
    page_icon="🚗",
    layout="wide"
)

st.title("🚗 Vehicle Image Processing Pipeline")
st.markdown("---")

with st.sidebar:
    st.header("Instructions")
    st.write("1. Upload a vehicle image (JPG/PNG).")
    st.write("2. The system will process it asynchronously.")
    st.write("3. View analysis results (Blur, Brightness, OCR, etc.).")
    
    st.info("Ensure the backend server is running on port 3000.")


uploaded_file = st.file_uploader("Choose a vehicle image...", type=["jpg", "jpeg", "png", "webp"])

if uploaded_file is not None:
    col1, col2 = st.columns([1, 1])
    
    with col1:
        st.subheader("Uploaded Image")
        image = Image.open(uploaded_file)
        st.image(image, use_container_width=True)

    with col2:
        st.subheader("Processing Status")
        
        uploaded_file.seek(0)
        img_bytes = uploaded_file.read()
        
        files = {"vehicle_image": (uploaded_file.name, img_bytes, uploaded_file.type)}
        
        if st.button("Analyze Image"):
            try:
                with st.spinner("Uploading to backend..."):
                    response = requests.post(f"{API_BASE_URL}/upload", files=files)
                    response.raise_for_status()
                    data = response.json()
                    processing_id = data["processing_id"]
                    st.success(f"Upload successful! ID: {processing_id}")

                status_placeholder = st.empty()
                progress_bar = st.progress(0)
                
                start_time = time.time()
                while True:
                    status_response = requests.get(f"{API_BASE_URL}/status/{processing_id}")
                    status_response.raise_for_status()
                    status_data = status_response.json()
                    status = status_data["status"]
                    
                    status_placeholder.write(f"Current Status: **{status.upper()}**")
                    
                    if status == "completed":
                        progress_bar.progress(100)
                        break
                    elif status == "failed":
                        st.error(f"Processing failed: {status_data.get('failure_reason', 'Unknown error')}")
                        break
                    
                    elapsed = time.time() - start_time
                    progress = min(90, int(elapsed * 10))
                    progress_bar.progress(progress)
                    
                    time.sleep(1)
                
                if status == "completed":
                    results_response = requests.get(f"{API_BASE_URL}/results/{processing_id}")
                    results_response.raise_for_status()
                    full_data = results_response.json()
                    
                    analysis = full_data.get("analysis", {})
                    conf = full_data.get("confidence_scores", {})
                    summary = full_data.get("summary", {})
                    
                    st.success("Analysis Complete!")
                    
                    quality = summary.get("quality", "Unknown")
                    quality_color = {"Good": "🟢", "Fair": "🟡", "Poor": "🔴"}.get(quality, "⚪")
                    st.markdown(f"### Overall Quality: {quality_color} **{quality}**")
                    
                    st.markdown("#### 📊 Analysis Results")
                    m1, m2, m3, m4 = st.columns(4)
                    
                    blur = analysis.get("blur", {})
                    brightness = analysis.get("brightness", {})
                    ocr = analysis.get("ocr", {})
                    screenshot = analysis.get("screenshot", {})
                    
                    m1.metric(
                        "Sharpness",       
                        f"{blur.get('score', 0)}/100",
                        delta="Sharp ✅" if not blur.get("isBlurry") else "Blurry ⚠️",
                        delta_color="normal" if not blur.get("isBlurry") else "inverse"
                    )
                    m2.metric(
                        "Brightness",
                        f"{brightness.get('score', 0)}/100",
                        delta="OK ✅" if not brightness.get("isTooDark") and not brightness.get("isTooBright") else "Out of range ⚠️",
                        delta_color="normal" if not brightness.get("isTooDark") and not brightness.get("isTooBright") else "inverse"
                    )
                    m3.metric(
                        "Plate Valid",
                        "✅ Yes" if ocr.get("valid") else "❌ No",
                        delta=f"OCR: {ocr.get('text', 'N/A')}"
                    )
                    m4.metric(
                        "Screenshot Risk",
                        f"{screenshot.get('score', 0)}%",
                        delta="Likely Screenshot ⚠️" if screenshot.get("isLikelyScreenshot") else "Real Photo ✅",
                        delta_color="inverse" if screenshot.get("isLikelyScreenshot") else "normal"
                    )
                    
                    st.markdown("#### 🎯 Confidence Scores")
                    st.caption("ℹ️ Sharpness: higher = sharper image. Screenshot: higher = more likely a real photo.")
                    conf_cols = st.columns(5)
                    conf_labels = ["overall", "blur", "brightness", "ocr", "screenshot"]
                    conf_display = ["Overall", "Sharpness", "Brightness", "Plate OCR", "Real Photo"]
                    for col, label, display in zip(conf_cols, conf_labels, conf_display):
                        score = conf.get(label, 0)
                        col.metric(display, f"{score}%")
                    
                    st.write(f"**Overall Confidence:** {conf.get('overall', 0)}%")
                    st.progress(conf.get('overall', 0) / 100)
                    
                    issues = summary.get("issues", [])
                    if issues:
                        st.markdown("#### ⚠️ Issues Detected")
                        for issue in issues:
                            severity_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(issue.get("severity", "low"), "⚪")
                            st.warning(f"{severity_icon} **{issue.get('message')}** — {issue.get('detail', '')}")
                    
                    recs = summary.get("recommendations", [])
                    if recs:
                        st.markdown("#### 💡 Recommendations")
                        for rec in recs:
                            st.info(f"• {rec}")

            except Exception as e:
                st.error(f"An error occurred: {e}")

st.markdown("---")
st.caption("Vehicle Image Processing Pipeline - Backend Take-home Assignment")
