---
trigger: docker, compose, container, port, volume, network
---

# Docker 중심 개발 & 네트워크 인프라 가이드 (docker_environment.md)

이 가이드는 Docker Compose 기반 개발 환경의 네트워크 진단, 포트 통제 정책, 그리고 볼륨 마운트 시 발생할 수 있는 주요 트러블슈팅 규칙을 다룹니다.

---

## 1. 디버깅/테스트 vs 프로덕션/검증 환경 분리

* **디버깅 및 테스트**: 소스 파일의 실시간 동기화를 위해 항상 Docker 볼륨 마운트를 사용해 개발을 전개합니다. 디버깅 편의성을 위해 임의로 `docker cp` 명령어를 사용하는 것은 금지합니다.
* **프로덕션 이미지 검증**: 로컬 개발 검증 완료 후, 볼륨 마운트가 제거된 상태의 독립 컨테이너 빌드를 통해 정상 작동(이미지 재빌드)을 검증해야 합니다. 이 과정에서 MongoDB, Redis 등의 연결 유효성이 격리된 네트워크 망 내에서 보장되는지 확인합니다.

---

## 2. 로컬 node_modules 볼륨 덮어쓰기 문제 해결

* 호스트 머신의 `node_modules`와 컨테이너 내의 `node_modules` 간 패키지 버전 불일치 문제를 막기 위해, 프로젝트 볼륨 마운트 시 반드시 컨테이너 전용 익명 볼륨 마운트를 지정해 주어야 합니다.
  * **올바른 예시 (`docker-compose.yml`)**:
    ```yaml
    volumes:
      - .:/app
      - /app/node_modules  # 익명 볼륨 마운트로 호스트 node_modules 오버라이드 방지
    ```

---

## 3. 호스트 포트 직접 노출 금지 및 프록시 경유 라우팅

* MongoDB (`27017`), Redis (`6379`), Meilisearch (`7700`)와 같은 인프라용 데이터베이스 서비스 포트를 호스트 머신에 직접 노출하지 않습니다.
* 모든 내부 웹 트래픽 및 API 게이트웨이 요청은 `Traefik` 리버스 프록시 도메인(예: `*.localhost`, `*.nip.io`)을 경유하여 Docker 네트워크 내부망 내에서 안전하게 라우팅되도록 환경을 유지해야 합니다.

---

## 4. Docker 내부 CLI 작업 및 네트워크 진단 규칙

* **CLI 작업 위임**: 외부 포트가 노출되지 않으므로, 데이터베이스 마이그레이션이나 CLI 툴 실행(예: `curl`)은 `docker compose run` 또는 `exec` 명령을 활용하여 컨테이너 네트워크 영역 내부에서 실행하도록 처리합니다.
  * **올바른 예시**:
    ```bash
    docker compose -p scraper run --rm worker curl ...
    ```
* **Netshoot 진단 컨테이너 사용**:
  - 네트워크 통신 장애나 API 검증 시, 서비스용 경량 이미지에 직접 `curl`이나 `ping` 도구를 추가 설치하지 않습니다.
  - 네트워크 진단용 전용 이미지가 포함된 `nicolaka/netshoot` 진단용 임시 컨테이너를 구동하여 네트워크 디버깅을 진행합니다.
* **DB 진단 MCP 도구 사용**:
  - 데이터베이스 상태, Meilisearch 인덱스 상태, Redis 상태 확인은 먼저 전용 MCP 도구(`run_mongo_query`, `run_meili_query`, `run_redis_query`)로 시도합니다.
  - MCP 도구가 지원하지 않는 재현 명령이나 컨테이너 내부 CLI 검증이 필요한 경우에만 `docker compose exec` / `run` 기반 셸 진단을 사용합니다.
  - 호스트에서 직접 포트에 붙는 방식은 사용하지 않습니다.
