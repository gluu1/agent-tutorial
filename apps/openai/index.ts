import OpenAI from "openai";

// 从环境变量获取 API Key
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("环境变量 OPENAI_API_KEY 未设置");
}

// OpenAI API 兼容 https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
const client = new OpenAI({
  apiKey,
  baseURL:
    process.env.OPENAI_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/",
});

// 天气数据接口
interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  windDirection: string;
  visibility: number;
  pressure: number;
  fishingSuitability: {
    score: number; // 0-100分
    verdict: string; // "非常适合", "适合", "一般", "不适合", "非常不适合"
    reasons: string[];
  };
}

// 钓鱼适宜性评估
function assessFishingSuitability(
  weather: Omit<WeatherData, "fishingSuitability">,
): WeatherData["fishingSuitability"] {
  const reasons: string[] = [];
  let score = 100;

  // 温度评估 (10-25度为最佳)
  if (weather.temperature >= 10 && weather.temperature <= 25) {
    reasons.push("温度适宜，鱼类活跃度高");
  } else if (weather.temperature < 5) {
    score -= 30;
    reasons.push("温度过低，鱼类活动减少");
  } else if (weather.temperature > 32) {
    score -= 25;
    reasons.push("温度过高，鱼类会游向深水区");
  }

  // 风速评估 (微风最佳)
  if (weather.windSpeed <= 3) {
    reasons.push("风力微弱，水面平稳，便于观察");
  } else if (weather.windSpeed <= 5) {
    reasons.push("微风徐徐，适合钓鱼");
  } else if (weather.windSpeed <= 7) {
    score -= 15;
    reasons.push("风力较大，抛竿有一定难度");
  } else {
    score -= 40;
    reasons.push("风力过大，不安全且难以控制鱼线");
  }

  // 天气状况评估
  const goodConditions = ["晴", "多云", "阴"];
  const badConditions = ["雨", "雷", "雪", "暴"];
  const hasBadCondition = badConditions.some((c) =>
    weather.condition.includes(c),
  );
  const hasGoodCondition = goodConditions.some((c) =>
    weather.condition.includes(c),
  );

  if (hasBadCondition) {
    score -= 35;
    reasons.push("恶劣天气，不建议户外活动");
  } else if (hasGoodCondition) {
    reasons.push("天气状况良好");
  }

  // 湿度评估
  if (weather.humidity > 85) {
    score -= 10;
    reasons.push("湿度过高，体感不适");
  } else if (weather.humidity >= 50 && weather.humidity <= 70) {
    reasons.push("湿度舒适");
  }

  // 能见度评估
  if (weather.visibility < 1) {
    score -= 20;
    reasons.push("能见度低，注意安全");
  }

  // 气压评估 (高气压通常鱼更活跃)
  if (weather.pressure > 1013) {
    reasons.push("气压较高，鱼类觅食积极");
  } else if (weather.pressure < 1000) {
    score -= 15;
    reasons.push("气压较低，可能影响鱼类活动");
  }

  // 根据分数给出结论
  let verdict: string;
  if (score >= 85) verdict = "非常适合";
  else if (score >= 70) verdict = "适合";
  else if (score >= 50) verdict = "一般";
  else if (score >= 30) verdict = "不适合";
  else verdict = "非常不适合";

  return { score, verdict, reasons };
}

// 模拟天气数据获取 (生产环境可接入真实API)
async function fetchWeather(location: string): Promise<WeatherData> {
  // 模拟不同城市的天气数据
  const mockData: Record<string, Omit<WeatherData, "fishingSuitability">> = {
    深圳: {
      location: "深圳",
      temperature: 22,
      condition: "多云",
      humidity: 65,
      windSpeed: 3,
      windDirection: "东南风",
      visibility: 10,
      pressure: 1015,
    },
    北京: {
      location: "北京",
      temperature: 8,
      condition: "晴",
      humidity: 40,
      windSpeed: 4,
      windDirection: "北风",
      visibility: 15,
      pressure: 1020,
    },
    上海: {
      location: "上海",
      temperature: 18,
      condition: "阴",
      humidity: 75,
      windSpeed: 2,
      windDirection: "东风",
      visibility: 8,
      pressure: 1012,
    },
  };

  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 500));

  const baseWeather = mockData[location] || {
    location,
    temperature: 20,
    condition: "晴",
    humidity: 60,
    windSpeed: 2,
    windDirection: "南风",
    visibility: 10,
    pressure: 1013,
  };

  const fishingSuitability = assessFishingSuitability(baseWeather);

  return {
    ...baseWeather,
    fishingSuitability,
  };
}

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather_for_fishing",
      description:
        "获取指定位置的天气信息，并判断是否适合钓鱼。返回详细的天气数据和钓鱼适宜性评估。",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "城市名称，例如：深圳、北京、上海",
          },
        },
        required: ["location"],
        additionalProperties: false,
      },
    },
  },
  { type: "web_search", name: "web_search", web_search: { enable: true } },
];

// 处理工具调用
async function handleToolCalls(response: any) {
  const message = response.choices[0].message;

  if (message.tool_calls) {
    const toolCalls = message.tool_calls;
    const toolResponses = [];

    for (const toolCall of toolCalls) {
      const { id, type, function: func } = toolCall;

      if (type === "function") {
        const { name, arguments: argsStr } = func;
        const args = JSON.parse(argsStr);

        let toolResult: string;

        if (name === "get_weather_for_fishing") {
          const { location } = args;
          const weatherData = await fetchWeather(location);

          const {
            location: loc,
            temperature,
            condition,
            humidity,
            windSpeed,
            windDirection,
            visibility,
            pressure,
            fishingSuitability,
          } = weatherData;

          toolResult = `📍 ${loc}天气情况\n\n🌡️ 温度: ${temperature}°C\n☁️ 天气: ${condition}\n💧 湿度: ${humidity}%\n💨 风速: ${windSpeed}级 (${windDirection})\n👁️ 能见度: ${visibility}km\n🔽 气压: ${pressure}hPa\n\n🎣 钓鱼适宜性评估:\n━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 综合评分: ${fishingSuitability.score}/100\n🎯 结论: ${fishingSuitability.verdict}\n\n📋 详细分析:\n${fishingSuitability.reasons.map((r) => `  • ${r}`).join("\n")}`;
        } else if (name === "get_weather") {
          const { location } = args;
          const weatherData = await fetchWeather(location);
          toolResult = `Current temperature in ${location}: ${weatherData.temperature}°C, condition: ${weatherData.condition}`;
        } else {
          toolResult = `Tool ${name} not implemented`;
        }

        toolResponses.push({
          role: "tool" as const,
          tool_call_id: id,
          name: name,
          content: toolResult,
        });
      }
    }

    // 发送工具响应并获取最终回复
    const followUpResponse = await client.chat.completions.create({
      model: "MiniMax-M2.7",
      tools,
      messages: [
        {
          role: "system",
          content: "你是一个有用的AI助手。",
        },
        {
          role: "user",
          content: "今天深圳天气？",
        },
        {
          role: "user",
          content: "今天深圳适合钓鱼么？",
        },
        message,
        ...toolResponses,
      ],
      top_p: 0.7,
      temperature: 0.9,
    });

    return followUpResponse.choices[0].message.content;
  } else {
    return message.content;
  }
}

const response = await client.chat.completions.create({
  model: "MiniMax-M2.7",
  tools,
  messages: [
    {
      role: "system",
      content: "你是一个有用的AI助手。",
    },
    {
      role: "user",
      content: "今天深圳天气？",
    },
    {
      role: "user",
      content: "今天深圳适合钓鱼么？",
    },
  ],
  top_p: 0.7,
  temperature: 0.9,
});

// console.log(response.choices[0].message.content);

const result = await handleToolCalls(response);
console.log(result);
