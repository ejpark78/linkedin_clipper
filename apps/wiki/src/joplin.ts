import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Writable } from 'stream';

const DEFAULT_JOPLIN_API_URL = 'http://host.docker.internal:41184';

// ==============================================================================
// 📋 Interfaces
// ==============================================================================

export interface WikiDocsChapter {
  title: string;
  url: string;
  content: string;
}

export interface WikiDocsBook {
  title: string;
  chapters: WikiDocsChapter[];
}

// ==============================================================================
// 🔐 Class: PasswordPrompt (Secure terminal password input utility)
// ==============================================================================

export class PasswordPrompt {
  /**
   * 입력을 터미널 화면에 노출하지 않고(마스킹) 입력을 받습니다.
   */
  public static getPassword(query: string): Promise<string> {
    // TTY가 아니거나 비대화형 환경인 경우 readline 실행 방지 및 예외 처리 가이드 출력
    if (!process.stdin.isTTY) {
      console.error(`\n❌ [Wiki CLI] TTY가 활성화되지 않은 비대화형 터미널 환경입니다.`);
      console.error(`👉 대화형 패스워드 입력을 구동할 수 없으므로, 필요한 자격 증명 환경 변수를 미리 선언하거나 주입해 주세요.`);
      console.error(`   - Joplin Server 연동 시: JOPLIN_PASSWORD 환경변수 기입`);
      console.error(`   - Web Clipper API 연동 시: JOPLIN_TOKEN 환경변수 기입`);
      console.error(`   - Obsidian 연동 시: OBSIDIAN_API_KEY 환경변수 기입\n`);
      return Promise.resolve('');
    }

    return new Promise((resolve) => {
      let muted = false;
      const mutableStdout = new Writable({
        write: (chunk, encoding, callback) => {
          if (!muted) {
            process.stdout.write(chunk, encoding);
          }
          callback();
        }
      });

      const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true
      });

      rl.question(query, (password) => {
        rl.close();
        process.stdout.write('\n');
        resolve(password);
      });
      
      muted = true;
    });
  }
}

// ==============================================================================
// 📖 Class: MarkdownBookLoader (SRP: Local markdown book file loading)
// ==============================================================================

export class MarkdownBookLoader {
  /**
   * 로컬 디렉터리 경로에서 책 정보를 WikiDocsBook 구조로 빌드하고 마크다운 파일을 로드합니다.
   */
  public static loadBook(directoryPath: string): WikiDocsBook {
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`디렉터리가 존재하지 않습니다: ${directoryPath}`);
    }

    const stat = fs.statSync(directoryPath);
    if (!stat.isDirectory()) {
      throw new Error(`디렉터리 경로가 아닙니다: ${directoryPath}`);
    }

    const bookTitle = path.basename(directoryPath);
    const files = fs.readdirSync(directoryPath);

    // .md 파일 필터링 (INDEX.md나 임시 파일 제외)
    const allMdFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      const name = path.basename(file, ext).toUpperCase();
      return ext === '.md' && name !== 'INDEX' && name !== 'README';
    });

    // 번역본 파일(.en-ko.md)이 있으면 원본(.md)은 배제
    const hasEnKo = new Set<string>();
    for (const file of allMdFiles) {
      if (file.toLowerCase().endsWith('.en-ko.md')) {
        const base = file.slice(0, -'.en-ko.md'.length).toLowerCase();
        hasEnKo.add(base);
      }
    }

    const mdFiles = allMdFiles.filter(file => {
      if (file.toLowerCase().endsWith('.en-ko.md')) {
        return true;
      }
      const ext = path.extname(file);
      const base = file.slice(0, -ext.length).toLowerCase();
      if (hasEnKo.has(base)) {
        return false;
      }
      return true;
    });

    mdFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const chapters: WikiDocsChapter[] = [];
    for (const file of mdFiles) {
      const filePath = path.join(directoryPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const title = path.basename(file, path.extname(file));

      chapters.push({
        title,
        url: `file://${filePath}`,
        content
      });
    }

    return {
      title: bookTitle,
      chapters
    };
  }
}



// ==============================================================================
// 📤 Class: JoplinWebClipperService (Joplin Web Clipper API Client)
// ==============================================================================

export class JoplinWebClipperService {
  private readonly token: string;
  private readonly apiUrl: string;

  constructor(token: string, apiUrl: string = DEFAULT_JOPLIN_API_URL) {
    this.token = token;
    this.apiUrl = apiUrl;
  }

  /**
   * Joplin Desktop에 Grant Permission 대화상자를 띄우고 토큰을 발급받습니다.
   * wikidocs-exporter의 getJoplinTokenWithApproval() 로직과 동일한 2-step auth flow입니다.
   * 
   * Step 1: POST /auth → 임시 auth_token 획득
   * Step 2: GET /auth/check?auth_token=xxx 폴링 (최대 timeoutMs)
   *         User가 Joplin에서 "Allow" 클릭 시 token 반환
   */
  public static async requestAuthToken(
    apiUrl: string = DEFAULT_JOPLIN_API_URL,
    timeoutMs: number = 60000
  ): Promise<string> {
    console.log('🔑 Joplin Desktop에 권한 요청 대화상자를 띄웁니다.');
    console.log('   Joplin 앱에서 "Allow"를 클릭해주세요.');

    const authResponse = await fetch(`${apiUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!authResponse.ok) {
      const errText = await authResponse.text();
      throw new Error(`Joplin 인증 요청 실패: ${authResponse.statusText}\n${errText}`);
    }

    const authData = (await authResponse.json()) as any;
    const authToken: string = authData.auth_token;
    if (!authToken) {
      throw new Error('Joplin 인증 응답에 auth_token이 없습니다.');
    }

    const maxAttempts = Math.max(1, Math.floor(timeoutMs / 1000));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const checkResponse = await fetch(`${apiUrl}/auth/check?auth_token=${encodeURIComponent(authToken)}`);
      if (!checkResponse.ok) continue;

      const checkData = (await checkResponse.json()) as any;
      if (checkData.status === 'accepted') {
        console.log('✅ Joplin 권한이 승인되었습니다.');
        return checkData.token;
      }
      if (checkData.status === 'rejected') {
        throw new Error('Joplin에서 접근이 거부되었습니다.');
      }
    }

    throw new Error('Joplin 인증 시간이 초과되었습니다. 앱에서 "Allow"를 클릭했는지 확인해주세요.');
  }

  /**
   * 기존 토큰이 유효한지 확인합니다.
   * GET /auth/check?token=xxx
   */
  public static async validateToken(
    apiUrl: string,
    token: string
  ): Promise<boolean> {
    try {
      const response = await fetch(`${apiUrl}/auth/check?token=${encodeURIComponent(token)}`);
      if (!response.ok) return false;
      const data = (await response.json()) as any;
      return data.status === 'accepted';
    } catch {
      return false;
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[\\/:*?"<>|]/g, '_');
  }

  /**
   * Joplin Web Clipper API를 호출해 전체 폴더(노트북) 목록을 받습니다.
   */
  public async getFolders(): Promise<any[]> {
    const url = `${this.apiUrl}/folders?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`폴더 목록 가져오기 실패: ${response.statusText}\n${errText}`);
    }
    const responseData = (await response.json()) as any;
    return (responseData.items || responseData) as any[];
  }

  /**
   * 특정 폴더 하위의 노트 목록을 메타데이터와 함께 조회합니다.
   */
  public async getNotesInFolder(folderId: string): Promise<any[]> {
    const url = `${this.apiUrl}/folders/${folderId}/notes?token=${encodeURIComponent(this.token)}&fields=id,title,body`;
    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`노트 목록 가져오기 실패: ${response.statusText}\n${errText}`);
    }
    const responseData = (await response.json()) as any;
    return (responseData.items || responseData) as any[];
  }

  /**
   * 특정 이미지 리소스의 메타데이터를 조회합니다.
   */
  public async getResourceMetadata(resourceId: string): Promise<any> {
    const url = `${this.apiUrl}/resources/${resourceId}?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`리소스 메타데이터 조회 실패: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * 특정 이미지 리소스 바이너리를 다운로드합니다.
   */
  public async downloadResourceFile(resourceId: string): Promise<Buffer> {
    const url = `${this.apiUrl}/resources/${resourceId}/file?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`리소스 파일 다운로드 실패: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Joplin Web Clipper API를 호출해 새 폴더(노트북)를 생성합니다.
   */
  public async createFolder(title: string): Promise<{ id: string }> {
    const url = `${this.apiUrl}/folders?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: this.sanitizeFilename(title)
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`폴더 생성 실패: ${response.statusText}\n${errorText}`);
    }

    return (await response.json()) as { id: string };
  }

  /**
   * 지정된 폴더 하위에 새 마크다운 노트를 포스팅합니다.
   */
  public async createNote(title: string, content: string, parentId: string): Promise<void> {
    const url = `${this.apiUrl}/notes?token=${encodeURIComponent(this.token)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: this.sanitizeFilename(title),
        body: content,
        parent_id: parentId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`노트 생성 실패: ${response.statusText}\n${errorText}`);
    }
  }
}

// ==============================================================================
// 🚦 Class: JoplinTaskRunner (Application Controller)
// ==============================================================================

export class JoplinTaskRunner {
  private static sanitizeDir(dir: string): string {
    return dir.replace(/[\\/:*?"<>|]/g, '_');
  }

  /**
   * 토큰이 없거나 유효하지 않을 때 Grant Permission auth flow를 통해 토큰을 해결합니다.
   * 실패 시 기존 interactive prompt로 fallback합니다.
   */
  private async resolveToken(apiUrl: string): Promise<string> {
    let token = process.env.JOPLIN_TOKEN;

    if (token) {
      const isValid = await JoplinWebClipperService.validateToken(apiUrl, token);
      if (isValid) return token;
      console.log('🔑 Joplin API 토큰이 유효하지 않습니다. 재발급을 시도합니다.');
    }

    try {
      token = await JoplinWebClipperService.requestAuthToken(apiUrl);
      await this.saveTokenToEnv(token);
      return token;
    } catch (authErr: any) {
      console.log(`⚠️ 자동 토큰 발급 실패: ${authErr.message}`);
      console.log('   대화형 입력으로 전환합니다.');
    }

    token = await PasswordPrompt.getPassword('Enter Joplin Web Clipper Token: ');
    if (!token.trim()) {
      throw new Error('Joplin Web Clipper Token 입력이 누락되었습니다.');
    }
    return token.trim();
  }

  /**
   * 획득한 토큰을 .env 파일에 저장하여 다음 실행부터 재사용합니다.
   */
  private async saveTokenToEnv(token: string): Promise<void> {
    const envPath = '/app/.env';
    try {
      let content = '';
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf-8');
      }

      const key = 'JOPLIN_TOKEN';
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${token}`);
      } else {
        content += `\n${key}=${token}\n`;
      }

      fs.writeFileSync(envPath, content, 'utf-8');
      console.log('💾 JOPLIN_TOKEN이 .env 파일에 저장되었습니다.');
    } catch (err: any) {
      console.warn(`⚠️ .env 파일 저장 실패: ${err.message} (토큰은 메모리에서만 유지됩니다)`);
    }
  }

  /**
   * [1] pull
   * 호스트 데스크톱 Joplin App Web Clipper API를 사용해 데이터를 백업/가져옵니다.
   */
  public async runPull(targetPath: string): Promise<void> {
    const apiUrl = process.env.JOPLIN_API_URL || DEFAULT_JOPLIN_API_URL;
    const token = await this.resolveToken(apiUrl);

    const clipperService = new JoplinWebClipperService(token, apiUrl);
    const folders = await clipperService.getFolders();
    console.log(`[JoplinTaskRunner] Found ${folders.length} notebooks in 데스크톱 Joplin. Commencing import...`);

    const folderMap = new Map<string, any>();
    for (const f of folders) {
      folderMap.set(f.id, f);
    }

    const resolvedTargetDir = path.resolve(targetPath);

    for (const folder of folders) {
      const relParts: string[] = [];
      let current: any = folder;
      while (current) {
        relParts.unshift(JoplinTaskRunner.sanitizeDir(current.title));
        current = current.parent_id ? folderMap.get(current.parent_id) : null;
      }
      const targetDir = path.join(resolvedTargetDir, ...relParts);
      const imagesDir = path.join(targetDir, 'images');

      const progressPrefix = `[${relParts.join(' / ')}]`;
      console.log(`${progressPrefix} Processing notebook "${folder.title}"...`);

      try {
        const notes = await clipperService.getNotesInFolder(folder.id);
        if (!notes || notes.length === 0) {
          console.log(`   ${progressPrefix} No notes found. Skipping.`);
          continue;
        }

        if (!fs.existsSync(imagesDir)) {
          fs.mkdirSync(imagesDir, { recursive: true });
        }

        let successCount = 0;
        for (const note of notes) {
          try {
            const cleanTitle = JoplinTaskRunner.sanitizeDir(note.title) || `Untitled_${note.id}`;
            const filePath = path.join(targetDir, `${cleanTitle}.md`);

            let bodyContent = note.body || '';

            const resourceRegex = /\(:\/([a-zA-Z0-9]{32})\)/g;
            let match;
            const processedResources = new Set<string>();

            while ((match = resourceRegex.exec(bodyContent)) !== null) {
              const resourceId = match[1];
              if (processedResources.has(resourceId)) continue;
              processedResources.add(resourceId);

              try {
                const meta = await clipperService.getResourceMetadata(resourceId);
                const fileExt = meta.file_extension ? `.${meta.file_extension}` : '.png';
                const imageFileName = `${resourceId}${fileExt}`;
                const imagePath = path.join(imagesDir, imageFileName);

                if (!fs.existsSync(imagePath)) {
                  console.log(`      Downloading image resource: ${resourceId}`);
                  const fileBuffer = await clipperService.downloadResourceFile(resourceId);
                  fs.writeFileSync(imagePath, fileBuffer);
                }

                const targetLink = `(:/${resourceId})`;
                const localLink = `(images/${imageFileName})`;
                bodyContent = bodyContent.split(targetLink).join(localLink);
              } catch (resourceErr: any) {
                console.error(`      Failed to process resource ${resourceId} for note ${note.title}:`, resourceErr.message);
              }
            }

            fs.writeFileSync(filePath, bodyContent, 'utf8');
            successCount++;
          } catch (noteErr: any) {
            console.error(`      Failed to save note ${note.title}:`, noteErr.message);
          }
        }
        console.log(`   ${progressPrefix} ${successCount} notes saved.`);
      } catch (err: any) {
        console.error(`   ${progressPrefix} Failed: ${err.message}`);
      }
    }

    console.log('[JoplinTaskRunner] Pull completed.');
  }

  /**
   * [2] push
   * 로컬 마크다운 서적을 호스트 데스크톱 Joplin App Web Clipper API로 전송(push)합니다.
   */
  public async runPush(fromPath: string, toPath?: string): Promise<void> {
    const apiUrl = process.env.JOPLIN_API_URL || DEFAULT_JOPLIN_API_URL;
    const token = await this.resolveToken(apiUrl);

    console.log(`[JoplinTaskRunner] Scanning local markdown directories in: ${fromPath}`);
    const book = MarkdownBookLoader.loadBook(fromPath);
    const targetNotebookName = toPath || book.title;

    console.log(`[JoplinTaskRunner] Pushing book "${book.title}" to 데스크톱 Joplin notebook "${targetNotebookName}"...`);
    const apiService = new JoplinWebClipperService(token, apiUrl);
    
    let folder: { id: string };
    try {
      folder = await apiService.createFolder(targetNotebookName);
    } catch (err: any) {
      throw new Error(`Joplin 데스크톱 앱에 노트북 폴더를 생성하지 못했습니다: ${err.message}`);
    }

    console.log(`[JoplinTaskRunner] Folder created (ID: ${folder.id}). Starting node push loop...`);
    for (let i = 0; i < book.chapters.length; i++) {
      const chapter = book.chapters[i];
      const progressPrefix = `[${i + 1}/${book.chapters.length}]`;
      console.log(`${progressPrefix} Pushing node: "${chapter.title}"...`);

      try {
        await apiService.createNote(chapter.title, chapter.content, folder.id);
      } catch (err: any) {
        console.error(`${progressPrefix} Failed to push note "${chapter.title}": ${err.message}`);
      }
    }

    console.log('[JoplinTaskRunner] Push completed.');
  }
}


