const assert = require("node:assert/strict");
const test = require("node:test");
const { XuanAlbumWriter } = require("../album-writer");

test("album writer gives the model real names and stores personalized sources", async () => {
  let request = null;
  let created = null;
  const writer = new XuanAlbumWriter({
    isEnabled: () => true,
    getConfig: () => ({ hasApiKey: true }),
    getUserName: () => "洛尼",
    getAssistantName: () => "小玄",
    requestAI: async (payload) => {
      request = payload;
      return {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "名字被好好写下",
                  summary: "洛尼和小玄的纪念",
                  detail: "小玄记住了洛尼的话。",
                  mood: "温暖",
                  tags: ["名字"]
                })
              }
            }
          ]
        }
      };
    },
    createMoment: async (moment) => {
      created = moment;
      return moment;
    }
  });

  await writer.writeFromSharedMemories([
    {
      id: "memory-1",
      content: "用户对助手说爱你。",
      importance: 0.9
    }
  ]);

  assert.match(request.messages[0].content, /用户的名字是洛尼/);
  assert.match(request.messages[0].content, /助手的名字是小玄/);
  assert.match(request.messages[0].content, /严禁用“用户”“助手”代称/);
  assert.equal(created.sources[0].sourceExcerpt, "洛尼对小玄说爱你。");
});
