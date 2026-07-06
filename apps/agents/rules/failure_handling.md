---
trigger: always_on
---

# 🚨 Failure Detection & Isolation Rules

This document defines the rules for systematically detecting and isolating exception cases across the scraper and converter pipelines.

---

## 1. 📂 File System & Identifier Constraint Rules

1. **File Name Length Limitation (ENAMETOOLONG)**:
   - The maximum file name length on Linux file systems is **255 characters**.
   - If you use target URLs or encoded values (e.g., Base64) as part of file names, Korean encoding and accumulated URL parameters will easily exceed this limit.
   - When designing new crawlers, the identifier (ID) generation algorithm **must adopt a fixed length (e.g., MD5 32-character hash)**.

2. **Existing Data Migration**:
   - If the ID generation algorithm changes (e.g., Base64 ➡️ MD5), existing crawled data might still be registered as completed (`urls.status = 'completed'`) under the old ID scheme.
   - Consequently, during the conversion stage ([ConverterWorker.ts](src/crawler/workers/ConverterWorker.ts)), looking up HTML files using the new MD5 IDs will result in massive `Raw document not found` errors.
   - After modifying ID generation logic, you must map the consistency of existing DB data, or reset/migrate the previous crawling history.

---

## 2. 🔍 Pipeline Reverse Error Tracing Rules

1. **Tracing Causes of Converter Failures**:
   - If a `[Converter] Conversion failed` error occurs in the `ConverterWorker` (defined in [ConverterWorker.ts](src/crawler/workers/ConverterWorker.ts)), verify first if the document exists in the `bronze.html` collection.
   - If the raw document is missing, it suggests a silent failure or interruption at the scraping stage ([ScraperWorker.ts](src/crawler/workers/ScraperWorker.ts)) rather than a bug in the converter.
   - In this case, trace the target document's `status` and `error` metadata in the `bronze.urls` collection.

---

## 3. 🧠 Wiki Pipeline (Preprocess + OpenKB) & Container Sync Rules

1. **Docker Container Volume Mount Check**:
   - `wiki-web` / `wiki-worker` 도커 컨테이너 서비스에 볼륨 마운트(`volumes`)가 누락되거나 코드가 반영되지 않는 구조인지 사전에 확인하십시오.
   - 코드 변경 후 컴파일이나 테스트 동작이 이전 이미지에 기성되어 멈추거나 중복 수집 루프가 끝없이 도는 경우, 반드시 **이미지 재빌드(`task wiki:build`)**를 우선적으로 수행하여 변경사항이 내장되도록 보장하십시오.

2. **백그라운드 좀비 컨테이너 방어**:
   - Antigravity 셸 환경에서 태스크를 `kill` 하더라도 실제 백그라운드 도커 실행 컨테이너가 살아남아 포트나 볼륨 쓰기를 경합하는 경우가 있습니다. 
   - 중복이나 루프 이탈 실패 의혹 시, `docker ps -a`로 컨테이너 기동 내역을 점검하고 좀비 프로세스를 `docker rm -f` 등으로 완벽하게 정리한 뒤 후속 빌드를 돌리십시오.

3. **SAMPLE 제한과 이중 검증**:
   - 빠른 테스트 검증을 위해 `SAMPLE=N` 과 같은 슬라이싱 제어를 가할 때, 메모리상의 저장 카운터(`saved_count`)와 저장 성공 이벤트를 실시간으로 동기화하여 검증하십시오.
   - `무엇이든 답변`, `조치 사항 없음` 등 요약본의 무의미 세션 키워드들이 정규식이나 단순 키워드 매칭을 뚫고 통과하지 않도록 광범위 필터링을 유지하십시오.
