import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import { Writable } from 'stream';

const execAsync = promisify(exec);

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
// 📥 Class: JoplinCliService (Joplin CLI Interaction Service)
// ==============================================================================

export class JoplinCliService {
  private readonly profileDir: string;
  private readonly env: any;

  constructor(profileDir: string = '/app/data/.joplin_profile') {
    this.profileDir = profileDir;
    this.env = {
      ...process.env,
      HOME: this.profileDir,
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    };
  }

  /**
   * 자식 프로세스를 생성하여 CLI 출력을 스트리밍 형식으로 실행합니다.
   */
  private runCommandStream(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { env: this.env });

      proc.stdout.on('data', (data) => {
        process.stdout.write(data.toString());
      });

      proc.stderr.on('data', (data) => {
        process.stderr.write(data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Joplin CLI에 서버 연동 자격 증명 설정을 반영합니다.
   */
  public async configureCredentials(
    serverUrl: string,
    username: string,
    password: string,
    decPassword?: string
  ): Promise<void> {
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }

    console.log(`[JoplinCliService] Configuring target sync server: ${serverUrl}`);
    await execAsync('joplin config sync.target 9', { env: this.env });
    await execAsync(`joplin config sync.9.path "${serverUrl.trim()}"`, { env: this.env });
    await execAsync(`joplin config sync.9.username "${username.trim()}"`, { env: this.env });
    await execAsync(`joplin config sync.9.password "${password.trim()}"`, { env: this.env });

    if (decPassword) {
      console.log('[JoplinCliService] Configuring E2EE decryption password...');
      await execAsync(`joplin encryption decrypt "${decPassword}"`, { env: this.env }).catch(err => {
        console.warn(`[Warning] Failed to set decryption password: ${err.message}`);
      });
    }
  }

  /**
   * Joplin Server 동기화(sync) 명령을 발송합니다.
   */
  public async sync(): Promise<void> {
    console.log('[JoplinCliService] Running sync...');
    await this.runCommandStream('joplin', ['sync']);
  }

  /**
   * Joplin 로컬 DB에 등록된 노트북 목록을 스캔하여 반환합니다.
   */
  public async getNotebooks(): Promise<string[]> {
    console.log('[JoplinCliService] Fetching local notebooks...');
    const { stdout } = await execAsync('joplin ls /', { env: this.env });
    const lines = stdout.split('\n');
    const notebooks: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let folderName = trimmed.split('(')[0].trim();
      if (folderName.endsWith('/')) {
        folderName = folderName.slice(0, -1).trim();
      }
      if (folderName && folderName !== '..' && folderName !== '.') {
        notebooks.push(folderName);
      }
    }
    return notebooks;
  }

  /**
   * 특정 노트북을 지정한 디렉터리에 마크다운 형태로 export합니다.
   */
  public async exportNotebook(notebookName: string, destDir: string): Promise<void> {
    await this.runCommandStream('joplin', ['export', '--format', 'md', '--notebook', notebookName, destDir]);
  }

  /**
   * 로컬 마크다운 디렉터리를 Joplin CLI DB에 임포트합니다.
   */
  public async importNotebook(srcDir: string, notebookName: string): Promise<void> {
    console.log(`[JoplinCliService] Importing markdown directory "${srcDir}" to notebook "${notebookName}"...`);
    await this.runCommandStream('joplin', ['import', '--format', 'md', srcDir, notebookName]);
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
   * [1] server:pull
   * Joplin CLI를 이용하여 Joplin Server와 동기화하고 로컬 노트북을 export합니다.
   */
  public async runServerPull(targetPath: string): Promise<void> {
    const serverUrl = process.env.JOPLIN_SERVER_URL;
    const username = process.env.JOPLIN_USERNAME;
    let password = process.env.JOPLIN_PASSWORD;
    const decPassword = process.env.JOPLIN_DEC_PASSWORD;

    if (!serverUrl || !username) {
      throw new Error('Joplin CLI Server Pull을 기동하려면 JOPLIN_SERVER_URL, JOPLIN_USERNAME 환경변수가 필수입니다.');
    }

    if (!password) {
      console.log('🔑 Joplin Password 환경 변수가 누락되었습니다.');
      password = await PasswordPrompt.getPassword('Enter Joplin Password: ');
      if (!password.trim()) {
        throw new Error('Joplin 비밀번호 입력이 누락되어 동기화를 취소합니다.');
      }
    }

    const cliService = new JoplinCliService();
    await cliService.configureCredentials(serverUrl, username, password, decPassword);
    await cliService.sync();

    const notebooks = await cliService.getNotebooks();
    console.log(`[JoplinTaskRunner] Found ${notebooks.length} notebooks. Commencing export...`);

    const resolvedTargetDir = path.resolve(targetPath);
    for (let i = 0; i < notebooks.length; i++) {
      const notebook = notebooks[i];
      const progressPrefix = `[${i + 1}/${notebooks.length}]`;
      console.log(`${progressPrefix} Exporting notebook: "${notebook}"...`);

      const cleanFolderName = JoplinTaskRunner.sanitizeDir(notebook);
      const finalDir = path.join(resolvedTargetDir, cleanFolderName);
      const tempExportDir = path.join(resolvedTargetDir, '.tmp_export', cleanFolderName);

      try {
        if (fs.existsSync(tempExportDir)) {
          fs.rmSync(tempExportDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempExportDir, { recursive: true });

        await cliService.exportNotebook(notebook, tempExportDir);

        if (fs.existsSync(finalDir)) {
          fs.rmSync(finalDir, { recursive: true, force: true });
        }
        fs.mkdirSync(path.dirname(finalDir), { recursive: true });
        fs.renameSync(tempExportDir, finalDir);
        console.log(`${progressPrefix} Exported "${notebook}" successfully.`);
      } catch (err: any) {
        console.error(`${progressPrefix} Failed to export "${notebook}": ${err.message}`);
      }
    }

    const tempDirParent = path.join(resolvedTargetDir, '.tmp_export');
    if (fs.existsSync(tempDirParent)) {
      fs.rmSync(tempDirParent, { recursive: true, force: true });
    }

    console.log('[JoplinTaskRunner] Server sync and export completed.');
  }

  /**
   * [2] server:push
   * 로컬의 마크다운 서적 디렉터리를 Joplin CLI를 사용해 로컬 DB에 임포트하고, sync를 실행하여 서버로 푸시합니다.
   */
  public async runServerPush(fromPath: string, toPath?: string): Promise<void> {
    const serverUrl = process.env.JOPLIN_SERVER_URL;
    const username = process.env.JOPLIN_USERNAME;
    let password = process.env.JOPLIN_PASSWORD;
    const decPassword = process.env.JOPLIN_DEC_PASSWORD;

    if (!serverUrl || !username) {
      throw new Error('Joplin CLI Server Push를 기동하려면 JOPLIN_SERVER_URL, JOPLIN_USERNAME 환경변수가 필수입니다.');
    }

    if (!password) {
      console.log('🔑 Joplin Password 환경 변수가 누락되었습니다.');
      password = await PasswordPrompt.getPassword('Enter Joplin Password: ');
      if (!password.trim()) {
        throw new Error('Joplin 비밀번호 입력이 누락되어 푸시를 취소합니다.');
      }
    }

    // 마크다운 책 정보 파싱
    console.log(`[JoplinTaskRunner] Loading local book from: ${fromPath}`);
    const book = MarkdownBookLoader.loadBook(fromPath);
    const targetNotebookName = toPath || book.title;

    const cliService = new JoplinCliService();
    await cliService.configureCredentials(serverUrl, username, password, decPassword);

    // Joplin CLI 로컬 DB로 임포트
    await cliService.importNotebook(fromPath, targetNotebookName);

    // 서버 동기화
    console.log('[JoplinTaskRunner] Pushing imported notebook to server via CLI sync...');
    await cliService.sync();

    console.log('[JoplinTaskRunner] Server push completed.');
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
   * [3] client:pull
   * 호스트 데스크톱 Joplin App Web Clipper API를 사용해 데이터를 백업/가져옵니다.
   */
  public async runClientPull(targetPath: string): Promise<void> {
    const apiUrl = process.env.JOPLIN_API_URL || DEFAULT_JOPLIN_API_URL;
    const token = await this.resolveToken(apiUrl);

    const clipperService = new JoplinWebClipperService(token, apiUrl);
    const folders = await clipperService.getFolders();
    console.log(`[JoplinTaskRunner] Found ${folders.length} notebooks in 데스크톱 Joplin. Commencing import...`);

    const resolvedTargetDir = path.resolve(targetPath);

    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const progressPrefix = `[${i + 1}/${folders.length}]`;
      console.log(`${progressPrefix} Processing notebook "${folder.title}"...`);

      const cleanFolderName = JoplinTaskRunner.sanitizeDir(folder.title);
      const targetDir = path.join(resolvedTargetDir, cleanFolderName);
      const imagesDir = path.join(targetDir, 'images');

      try {
        const notes = await clipperService.getNotesInFolder(folder.id);
        if (!notes || notes.length === 0) {
          console.log(`   ${progressPrefix} No notes found in notebook "${folder.title}". Skipping.`);
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

            // 이미지 리소스 다운로드 및 상대 경로 매핑 (:/리소스ID)
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
        console.log(`   ${progressPrefix} Notebook "${folder.title}" processed (${successCount} notes saved).`);
      } catch (err: any) {
        console.error(`   ${progressPrefix} Failed to pull notebook "${folder.title}": ${err.message}`);
      }
    }

    console.log('[JoplinTaskRunner] Client pull completed.');
  }

  /**
   * [4] client:push
   * 로컬 마크다운 서적을 호스트 데스크톱 Joplin App Web Clipper API로 전송(push)합니다.
   */
  public async runClientPush(fromPath: string, toPath?: string): Promise<void> {
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

    console.log('[JoplinTaskRunner] Client push completed.');
  }
}


