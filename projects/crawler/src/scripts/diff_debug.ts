import * as fs from "fs";
import * as path from "path";
import { DailyDoseDSConverter } from "../sites/dailydoseofds/Converter";
import { GeekNewsConverter } from "../sites/geeknews/Converter";
import { PyTorchKRConverter } from "../sites/pytorch_kr/Converter";

(async () => {
  // 1. DailyDoseDS fixtures
  const dddsConverter = new DailyDoseDSConverter();
  const dddsDir = path.join(
    __dirname,
    "../../tests/sites/dailydoseofds/fixtures",
  );
  const dddsCases = [
    {
      file: "course_7.html",
      url: "https://www.dailydoseofds.com/rl-course-part-7/",
      expectedFile: "course_7.expected.md",
    },
    {
      file: "hermes.html",
      url: "https://www.dailydoseofds.com/p/hermes-agent-masterclass/",
      expectedFile: "hermes.expected.md",
    },
    {
      file: "speculative.html",
      url: "https://www.dailydoseofds.com/p/speculative-decoding-in-llms/",
      expectedFile: "speculative.expected.md",
    },
    {
      file: "course_6.html",
      url: "https://www.dailydoseofds.com/rl-course-part-6/",
      expectedFile: "course_6.expected.md",
    },
  ];
  for (const tc of dddsCases) {
    const html = fs.readFileSync(path.join(dddsDir, tc.file), "utf-8");
    const result = await dddsConverter.convertHtmlToMarkdown(
      html,
      tc.file.replace(".html", ""),
      tc.url,
    );
    fs.writeFileSync(
      path.join(dddsDir, tc.expectedFile),
      result.rawContent,
      "utf-8",
    );
    console.log(`💾 Updated DailyDoseDS fixture: ${tc.expectedFile}`);
  }

  // 2. GeekNews fixtures
  const gnConverter = new GeekNewsConverter();
  const gnDir = path.join(__dirname, "../../tests/sites/geeknews/fixtures");
  const gnCases = [
    {
      file: "4265.html",
      url: "https://news.hada.io/topic?id=4265",
      expectedFile: "4265.expected.md",
    },
    {
      file: "5299.html",
      url: "https://news.hada.io/topic?id=5299",
      expectedFile: "5299.expected.md",
    },
    {
      file: "1069.html",
      url: "https://news.hada.io/topic?id=1069",
      expectedFile: "1069.expected.md",
    },
    {
      file: "2994.html",
      url: "https://news.hada.io/topic?id=2994",
      expectedFile: "2994.expected.md",
    },
  ];
  for (const tc of gnCases) {
    const html = fs.readFileSync(path.join(gnDir, tc.file), "utf-8");
    const result = await gnConverter.convertHtmlToMarkdown(
      html,
      tc.file.replace(".html", ""),
      tc.url,
    );
    fs.writeFileSync(
      path.join(gnDir, tc.expectedFile),
      result.rawContent,
      "utf-8",
    );
    console.log(`💾 Updated GeekNews fixture: ${tc.expectedFile}`);
  }

  // 3. PyTorch KR fixtures
  const pkConverter = new PyTorchKRConverter();
  const pkDir = path.join(__dirname, "../../tests/sites/pytorch_kr/fixtures");
  const pkCases = ["10483", "10523", "10492"];
  for (const id of pkCases) {
    const html = fs.readFileSync(path.join(pkDir, `${id}.json.html`), "utf-8");
    const result = await pkConverter.convertHtmlToMarkdown(
      html,
      id,
      `https://discuss.pytorch.kr/t/topic/${id}`,
    );
    fs.writeFileSync(
      path.join(pkDir, `${id}.expected.md`),
      result.rawContent,
      "utf-8",
    );
    console.log(`💾 Updated PyTorch KR fixture: ${id}.expected.md`);
  }

  console.log("🎉 All fixtures updated successfully!");
})();
