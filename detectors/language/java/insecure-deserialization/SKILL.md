---
id: java-deserialization
title: Java Insecure Deserialization
stages: [llm-scan, validate]
severity: critical
description: Detects Java insecure deserialization — ObjectInputStream.readObject without type validation, missing deserialization filters, and expression language injection (SpEL, OGNL).
classical_prepass: semgrep
classical_hint: p/java
---

# Java Insecure Deserialization Detector

## Detection Prompt

```
Analyze Java/Kotlin code for insecure deserialization. Look for:

1. ObjectInputStream without Validation:
   - ObjectInputStream.readObject() without LookAheadObjectInputStream
   - No deserialization filter (ObjectInputFilter) configured
   - Serializable classes with readObject that don't validate types
   - ObjectInputStream from untrusted sources (network sockets, HTTP requests, file uploads)

2. Dangerous Deserialization Libraries:
   - XStream without type allowlisting
   - Jackson with enableDefaultTyping() (polymorphic deserialization)
   - SnakeYAML without SafeConstructor
   - Kryo deserialization without class registration
   - Hessian/Burlap deserialization from untrusted sources

3. Expression Language Injection:
   - SpEL (Spring Expression Language): ExpressionParser.parseExpression(userInput)
   - OGNL: Ognl.getValue(userInput, context)
   - MVEL: MVEL.eval(userInput)
   - JEXL: JexlEngine.createExpression(userInput)
   - JSTL/EL with user-controlled expressions

4. XXE in XML Parsers:
   - DocumentBuilderFactory without FEATURE_SECURE_PROCESSING
   - SAXParser without disabling external entities
   - XMLInputFactory without IS_SUPPORTING_EXTERNAL_ENTITIES = false
   - JAXB Unmarshaller without secure configuration

Code context:
{code}
```

## Validation Prompt

```
Java deserialization at {file}:{line}. Is deserialization from untrusted source? Is there type validation/filtering? Are dangerous gadget classes accessible on classpath?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- Deserialization of trusted internal data (cached objects, IPC between same-JVM services)
- Jackson with DefaultTyping disabled (default in newer versions)
- ObjectInputFilter with strict type allowlisting
- JAXB with secure processing features enabled
