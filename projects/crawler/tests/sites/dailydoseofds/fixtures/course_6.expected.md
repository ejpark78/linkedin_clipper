# 📂 [Daily Dose of DS] Introduction to Deep RL and DQN

* **작성일:** Published on May 31, 2026
* **원본 링크:** [바로가기](https://www.dailydoseofds.com/rl-course-part-6/)

## 📝 본문 내용

## Reinforcement Learning Course

-   -   [Foundations of Reinforcement Learning](https://www.dailydoseofds.com/rl-course-part-1/)
    -   [Markov Decision Processes and Value Functions](https://www.dailydoseofds.com/rl-course-part-2/)
    -   [Bellman Equations and Dynamic Programming](https://www.dailydoseofds.com/rl-course-part-3/)
    -   [Model-Free Learning](https://www.dailydoseofds.com/rl-course-part-4/)
    -   [Function Approximation](https://www.dailydoseofds.com/rl-course-part-5/)
    -   [Introduction to Deep RL and DQN](https://www.dailydoseofds.com/rl-course-part-6/)
    -   [Policy Gradients: REINFORCE and Actor-Critic](https://www.dailydoseofds.com/rl-course-part-7/)

Reinforcement Learning Course

[](https://www.dailydoseofds.com/rl-course-part-6/# "Previous")[](https://www.dailydoseofds.com/rl-course-part-6/# "Next")

Reinforcement Learning Course

6/7[](https://www.dailydoseofds.com/rl-course-part-5/ "Previous")[](https://www.dailydoseofds.com/rl-course-part-7/ "Next")

16 min read

# Introduction to Deep RL and DQN

RL Part 6: From linear features to neural networks, and the engineering choices that makes deep value-based RL possible.

👉

Hey! This is a member-only post. But it looks like you are from **Turkey 🇹🇷**. Join today by visiting this **[membership page](https://www.dailydoseofds.com/membership-JC183D6A-KSO31NS1A/)** for relief pricing of **50%** off on your full access, FOREVER.

* * *

## Recap

In the previous chapter, we made the transition from tables to parameterized value functions.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!03Wl!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F739afb3b-2d13-40e1-8690-4a71922c26d9_2000x1124.png "upload in progress, 0")

The reasons were structural. Tables do not scale, and they do not generalize. Mountain car has a state space made of two real numbers, so it is impossible to even index into a table for it. And updating one cell of a Q-table tells us nothing about the cell next to it. The fix was to write the value function as a function over states, with a small parameter vector θ θ controlling its shape.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!XKS3!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F58ec7ef8-5c8e-4143-bc0c-c6f93e551bbb_292x75.png "upload in progress, 0")

We laid out the prediction objective, mean square value error. We then worked through linear function approximation in detail, where the value estimate is the inner product of fixed features and learnable weights.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!HMGO!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F464c591a-11aa-4f8e-acce-93548827df33_543x125.png "upload in progress, 0")

From that foundation, we built two learning algorithms:

-   Gradient Monte Carlo uses the full return as a target, which makes it a true gradient method on a well-defined squared-error objective.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!0Km0!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcd00a76d-a823-4a33-9b4d-c3a3f7a0b2fe_581x170.png "upload in progress, 0")

-   Semi-gradient TD(0) replaces the return with a bootstrapped target, gaining online updates and low variance, but introducing the bias of differentiating only the prediction and not the target.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!47Cj!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffc5adfc7-ebc4-49b1-a4eb-bb7ddb4f2657_712x146.png "upload in progress, 0")

We then extended our understanding to control:

-   Semi-gradient SARSA learns the action-value function on-policy and works reliably with linear features.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!_JlP!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffd2d8e8d-4ca6-4079-8a93-09bb6408498a_983x95.png "upload in progress, 0")

-   Semi-gradient Q-learning uses the max over next actions, making it off-policy. This places it squarely inside what Sutton and Barto call the deadly triad: function approximation, bootstrapping, and off-policy learning combined.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!mhuh!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8bfe7021-126f-4dc0-9698-348581ceca89_988x100.png "upload in progress, 0")

Finally in the hands-on section, we saw the deadly triad cause divergence on Baird's counterexample, a tiny seven-state MDP where the weights grow without bound even though the true value function is zero everywhere.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!UiZ1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fcf86aaa0-5d5f-4bc2-8f93-437812321e32_1080x600.png "upload in progress, 0")

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!scik!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9be986d7-6551-4ad8-a809-76ad564c4cda_1080x600.png "upload in progress, 0")

We also saw the other side of the picture with semi-gradient SARSA on Mountain Car. Tile coding gave us a useful continuous-state representation, and the cost-to-go surface reconstructed the underlying physics of the task.

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!aZPK!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1ed7e765-fc58-41ca-b496-53ae33cfeb93_960x600.png "upload in progress, 0")

![upload in progress, 0](https://substackcdn.com/image/fetch/$s_!LaEd!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe734c4e3-6432-4901-96d6-95fb9b33a826_2160x480.png "upload in progress, 0")

If you have not read Chapter 5, we recommend doing so first:

[Function Approximation

RL Part 5: From tables to parameterized value functions.

![](https://static.ghost.org/v5.0.0/images/link-icon.svg)Daily Dose of Data ScienceAvi Chawla

![](https://storage.ghost.io/c/3f/df/3fdf6ed2-17ac-4b12-a693-8078bd13e748/content/images/thumbnail/rl-cover-2-996e97d504e9f5b6d4180d6b8fc38ebf6cd85d325f885f59f07141ca4e59a2b1.png)

](https://www.dailydoseofds.com/rl-course-part-5/)

* * *

## Introduction

The deadly triad demonstration at the end of Chapter 5 made one thing clear. Combining function approximation, bootstrapping, and off-policy learning creates a real risk of divergence, and that combination is exactly what we want for scalable value-based RL:

-   We want function approximation because tables do not scale.
-   We want bootstrapping because waiting for full returns is slow.
-   We want off-policy learning because we want to learn about an optimal greedy policy while exploring with a softer one.

This chapter is about how the field made that combination work in practice.

![The deadly triad in deep RL: three ingredients (function approximation, bootstrapping, off-policy learning) combining in...](https://substackcdn.com/image/fetch/$s_!Dxpj!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F202a07f7-7d3f-4545-a851-8ee1f2ba468f_1376x768.png "The deadly triad in deep RL: three ingredients (function approximation, bootstrapping, off-policy learning) combining in...")

We will extend the function class from linear to neural, watch new instabilities emerge in the deep setting, and see how DQN's two engineering choices, experience replay and target networks, tame them. The chapter then closes with a hands-on experiment training a DQN agent on CartPole.

👉

CartPole is a classic control theory and reinforcement learning benchmark. The objective is to balance a pole vertically on a moving cart by applying left or right forces.

Let's begin!

* * *

## From linear to neural

The mechanical step from linear function approximation to neural function approximation is small. We already know the action-value function as a linear combination of features:

![](https://substackcdn.com/image/fetch/$s_!_1gW!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F79c4e332-7617-424d-bf0f-203a7a7998d8_339x102.png)

The shift is to replace this expression with a more general parameterized function:

![](https://substackcdn.com/image/fetch/$s_!6UHq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F10dc0c81-9a85-4127-8cba-62679acde5fb_387x73.png)

where, fθ f θ is now any function differentiable in θ θ , typically a neural network.

The structure tells us the key change. With linear FA, the features carried the inductive bias and the weights did the learning. With neural FA, the network does both. Nothing about the underlying RL problem changes.

The MDP is the same, the Bellman equations are the same, only the function class used to approximate the value function has grown.

![](https://substackcdn.com/image/fetch/$s_!Xh6v!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F53b093a1-96a6-4a4e-94d3-827edf00377a_2000x1121.png)

The reason we want this change is representation learning. Hand-designed features work well when the state space is low-dimensional and we know what matters. But for higher dimensions, we almost always have no idea what the right features are. A neural network discovers them from data.

👉

The gradient computation also changes. With linear FA, the gradient of ^q q ^ with respect to θ θ was just ϕ(s,a) ϕ ( s , a ) . With neural FA, the gradient is computed by backpropagation through the network.

The trade-off is theoretical. In Chapter 5, we noted that linear on-policy semi-gradient TD converges to a unique fixed point. That result depends on linearity. With nonlinear function approximation, even on-policy semi-gradient TD can diverge.

So moving to neural networks gives up the theoretical guarantees we had with linear FA, even before we add off-policy learning back into the mix.

The field accepts this trade-off because the empirical results justify it, and because engineering choices make the situation tractable in practice.

In summary, the move to neural function approximation is a small mechanical change that buys us representation learning, at the cost of the convergence guarantees we had with linear features.

The rest of the chapter is about what goes wrong when we make this move, and what we do about it.

* * *

## The naive approach and what breaks

Let's try the most direct approach. Take semi-gradient Q-learning from Chapter 5, swap the linear function for a neural network, and run it online.

The update rule is:

![](https://substackcdn.com/image/fetch/$s_!pnX_!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdc48818e-627a-492e-8779-091a03da3a57_1257x209.png)

The terms:

-   The bracketed expression is the TD error.
-   ∇θ^q(St,At,θ) ∇ θ q ^ ( S t , A t , θ ) is the gradient of the predicted Q-value with respect to all network parameters, computed by backpropagation.
-   α α is the step size.

In structure, this is identical to what we had with linear FA. The only difference is what ^q q ^ and its gradient look like under the hood.

Run this loop on a problem like CartPole, and the agent learns nothing. Often, the weights drift, the loss climbs, and the agent's behavior gets worse over time.

There are three reasons, and each one maps back to something we already discussed in Chapter 5:

-   The first problem is sample correlation. In online learning, the data we train on comes from consecutive transitions in the environment. Two consecutive states in CartPole differ by one small physics step. Thus two consecutive samples are not independent, they are tightly correlated. Stochastic gradient descent assumes (or at least works much better with) approximately independent and identically distributed samples. When samples come in a correlated sequence, the network overfits to whatever local region of the state space the agent happens to be in, and forgets about regions it visited earlier.

![](https://substackcdn.com/image/fetch/$s_!lijc!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F58b3407c-c109-4970-8347-8e51a5824e88_2000x1038.png)

-   The second problem is non-stationary targets. The TD target Rt+1+γmaxa′^q(St+1,a′,θ) R t + 1 + γ max a ′ q ^ ( S t + 1 , a ′ , θ ) depends on θ θ . Every time we take a gradient step, the target shifts too. We are trying to fit a moving target, and the moving target depends on us. In Chapter 5 we spelled this out as the core of the semi-gradient idea: we differentiate only the prediction, not the target. With linear FA and on-policy sampling, this was tolerable. But with neural FA and off-policy sampling, the same trick stops being tolerable. A small change in θ θ propagates through the network and can change the predicted value at many states at once, including the next state we are about to bootstrap from. The target now moves in unpredictable directions every update.
-   The third problem is the deadly triad in full nonlinear form. We are using function approximation (the network), bootstrapping (the TD target), and off-policy learning (the max over next actions). This is exactly the combination Baird's counterexample showed was unstable, and now we are scaling it up to a much larger function class.

![](https://substackcdn.com/image/fetch/$s_!JFKF!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc5c88ce9-ccc8-4e04-9daa-f45f4d45648c_2000x768.png)

This was the situation in 2013, when Mnih et al. published "Playing Atari with Deep Reinforcement Learning". It was the first deep learning model to successfully learn control policies directly from high-dimensional sensory input using reinforcement learning.

The contribution was not the basic idea of combining Q-learning with a neural network. That had been tried before. The contribution was the engineering choices that made it work: experience replay and, in the 2015 Nature version, target networks. We turn to those next.

* * *

## Experience replay

The first of DQN's two engineering choices is experience replay.
