import * as fs from 'fs';
import { JoplinTaskRunner, JoplinWebClipperService, PasswordPrompt, MarkdownBookLoader } from './joplin';
import { ObsidianClipperService } from './obsidian';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (!command) {
      console.error('사용할 명령어를 선택하세요. (지원 명령어: joplin:pull, joplin:push, joplin:auth, obsidian:push)');
      process.exit(1);
    }

    if (command.startsWith('joplin:')) {
      const joplinCommand = command.replace('joplin:', '');
      const runner = new JoplinTaskRunner();

      if (joplinCommand === 'pull') {
        const targetPath = args[1] || 'data/joplin';
        await runner.runPull(targetPath);
      } else if (joplinCommand === 'push') {
        const fromPath = args[1];
        const toPath = args[2];
        if (!fromPath) {
          console.error('Usage: task wiki:joplin:push FROM_PATH=<path> [TO_PATH=<name>]');
          process.exit(1);
        }
        await runner.runPush(fromPath, toPath);
      } else if (joplinCommand === 'auth') {
        const apiUrl = process.env.JOPLIN_API_URL || 'http://host.docker.internal:41184';
        console.log('[Wiki Entrypoint] Joplin Grant Permission auth flow 시작...');
        const token = await JoplinWebClipperService.requestAuthToken(apiUrl);
        const envPath = '/app/.env';
        let content = '';
        if (fs.existsSync(envPath)) {
          content = fs.readFileSync(envPath, 'utf-8');
        }
        const regex = /^JOPLIN_TOKEN=.*/m;
        if (regex.test(content)) {
          content = content.replace(regex, `JOPLIN_TOKEN=${token}`);
        } else {
          content += `\nJOPLIN_TOKEN=${token}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf-8');
        console.log('✅ JOPLIN_TOKEN이 .env 파일에 저장되었습니다.');
      } else {
        console.error(`알 수 없는 Joplin 명령어입니다: ${joplinCommand}`);
        process.exit(1);
      }
    } else if (command === 'obsidian:push') {
      const fromPath = args[1];
      const toPath = args[2];

      if (!fromPath) {
        console.error('Usage: task wiki:obsidian:push FROM_PATH=<path> [TO_PATH=<name>]');
        process.exit(1);
      }

      let apiKey = process.env.OBSIDIAN_API_KEY;
      const apiUrl = process.env.OBSIDIAN_API_URL || 'http://host.docker.internal:27123';

      if (!apiKey) {
        console.log('🔑 Obsidian Local REST API 키가 환경 변수에 제공되지 않았습니다.');
        apiKey = await PasswordPrompt.getPassword('Enter Obsidian REST API Key: ');
        if (!apiKey.trim()) {
          throw new Error('Obsidian REST API Key 입력이 누락되어 푸시를 중단합니다.');
        }
      }

      console.log(`[Wiki Entrypoint] Loading local markdown book from: ${fromPath}`);
      const book = MarkdownBookLoader.loadBook(fromPath);
      
      const obsidianService = new ObsidianClipperService(apiKey, apiUrl);
      await obsidianService.pushBook(book, toPath);

      console.log('[Wiki Entrypoint] Obsidian push completed.');
    } else {
      console.error(`알 수 없는 명령어입니다: ${command}`);
      console.error('지원 명령어: joplin:pull, joplin:push, joplin:auth, obsidian:push');
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`❌ 실행 도중 장애 발생: ${err.message}`);
    process.exit(1);
  }
}

main();
